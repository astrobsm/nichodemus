/** Inventory, stock movement, suppliers and procurement (spec S31-S34). */
import { query, queryOne, count, transaction } from '../sqlite'
import {
  boolInt,
  findAll,
  insertEnvelope,
  insertRow,
  nullIfBlank,
  softDelete,
  updateEnvelope,
  updateRow,
} from './base'
import { audit, AUDIT_ACTIONS, auditActor } from '../../core/audit'
import { addDays, nowIso, today } from '../../core/datetime'
import { procurementCode } from '../../core/ids'

export interface InventoryItem {
  id: number
  project_id: number
  name: string
  category: string
  unit: string
  opening_qty: number
  qty_purchased: number
  qty_used: number
  min_stock: number
  supplier_id: number | null
  unit_cost: number | null
  batch_number: string | null
  expiry_date: string | null
  is_medical: number
  notes: string | null
  version: number
}

export type StockState = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
export type ExpiryState = 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NOT_APPLICABLE'

/** Remaining = opening + purchased - used (spec S31). */
export function remainingQty(item: InventoryItem): number {
  const r =
    Number(item.opening_qty) + Number(item.qty_purchased) - Number(item.qty_used)
  return Math.round(r * 1000) / 1000
}

export function stockState(item: InventoryItem): StockState {
  const remaining = remainingQty(item)
  if (remaining <= 0) return 'OUT_OF_STOCK'
  if (remaining <= Number(item.min_stock)) return 'LOW_STOCK'
  return 'IN_STOCK'
}

export const EXPIRY_WARNING_DAYS = 60

export function expiryState(item: InventoryItem, asOf = today()): ExpiryState {
  if (!item.expiry_date) return 'NOT_APPLICABLE'
  const expiry = item.expiry_date.slice(0, 10)
  if (expiry < asOf) return 'EXPIRED'
  if (expiry <= addDays(asOf, EXPIRY_WARNING_DAYS)) return 'EXPIRING_SOON'
  return 'OK'
}

export interface InventoryItemInput {
  name: string
  category: string
  unit?: string
  openingQty?: number
  minStock?: number
  supplierId?: number | null
  unitCost?: number | null
  batchNumber?: string
  expiryDate?: string
  isMedical?: boolean
  notes?: string
}

export async function createInventoryItem(
  projectId: number,
  input: InventoryItemInput,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    const id = insertRow('inventory_items', {
      ...insertEnvelope(),
      project_id: projectId,
      name: input.name.trim(),
      category: input.category,
      unit: input.unit || 'unit',
      opening_qty: input.openingQty ?? 0,
      qty_purchased: 0,
      qty_used: 0,
      min_stock: input.minStock ?? 0,
      supplier_id: input.supplierId ?? null,
      unit_cost: input.unitCost ?? null,
      batch_number: nullIfBlank(input.batchNumber),
      expiry_date: nullIfBlank(input.expiryDate),
      is_medical: boolInt(input.isMedical ?? true),
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    if ((input.openingQty ?? 0) > 0) {
      insertRow('inventory_transactions', {
        ...insertEnvelope(),
        item_id: id,
        project_id: projectId,
        txn_type: 'OPENING',
        quantity: input.openingQty ?? 0,
        balance_after: input.openingQty ?? 0,
        reason: 'Opening stock',
        occurred_at: nowIso(),
        actor: auditActor().username,
        is_demo: boolInt(isDemo),
      })
    }
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'inventory_item',
      entityId: id,
      summary: `Inventory item added: ${input.name}`,
    })
    return id
  })
}

export async function updateInventoryItem(
  id: number,
  input: Partial<InventoryItemInput>,
): Promise<void> {
  const before = getInventoryItem(id)
  if (!before) throw new Error('That inventory item no longer exists.')
  await transaction(() => {
    updateRow('inventory_items', id, {
      ...updateEnvelope(before.version),
      name: input.name ?? before.name,
      category: input.category ?? before.category,
      unit: input.unit ?? before.unit,
      min_stock: input.minStock ?? before.min_stock,
      supplier_id: input.supplierId !== undefined ? input.supplierId : before.supplier_id,
      unit_cost: input.unitCost !== undefined ? input.unitCost : before.unit_cost,
      batch_number:
        input.batchNumber !== undefined ? nullIfBlank(input.batchNumber) : before.batch_number,
      expiry_date:
        input.expiryDate !== undefined ? nullIfBlank(input.expiryDate) : before.expiry_date,
      notes: input.notes !== undefined ? nullIfBlank(input.notes) : before.notes,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'inventory_item',
      entityId: id,
      summary: `Inventory item updated: ${before.name}`,
    })
  })
}

export function getInventoryItem(id: number): InventoryItem | null {
  return queryOne<InventoryItem>(
    'SELECT * FROM inventory_items WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

export function listInventory(projectId: number, category?: string): InventoryItem[] {
  const clause = category ? 'project_id = ? AND category = ?' : 'project_id = ?'
  const params = category ? [projectId, category] : [projectId]
  return findAll<InventoryItem>('inventory_items', clause, params, 'category, name')
}

export class InsufficientStockError extends Error {
  constructor(itemName: string, remaining: number, requested: number, unit: string) {
    super(
      `There is not enough ${itemName} in stock. ${remaining} ${unit} remaining, ` +
        `${requested} ${unit} requested.`,
    )
    this.name = 'InsufficientStockError'
  }
}

export class ExpiredStockError extends Error {
  constructor(itemName: string, expiry: string) {
    super(
      `${itemName} expired on ${expiry}. Expired products must not be issued. ` +
        `Record this as wastage instead.`,
    )
    this.name = 'ExpiredStockError'
  }
}

/**
 * Records a stock movement and updates the item balance in one transaction.
 * Issuing expired stock is refused (spec S33).
 */
export async function recordStockMovement(
  itemId: number,
  txnType: 'PURCHASE' | 'USAGE' | 'ADJUSTMENT' | 'WASTAGE',
  quantity: number,
  reason: string,
  stationId: number | null = null,
): Promise<number> {
  const item = getInventoryItem(itemId)
  if (!item) throw new Error('That inventory item no longer exists.')
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('The quantity must be a positive number.')
  }

  const remaining = remainingQty(item)
  if (txnType === 'USAGE') {
    if (expiryState(item) === 'EXPIRED') {
      throw new ExpiredStockError(item.name, item.expiry_date!.slice(0, 10))
    }
    if (quantity > remaining) {
      throw new InsufficientStockError(item.name, remaining, quantity, item.unit)
    }
  }
  if (txnType === 'WASTAGE' && quantity > remaining) {
    throw new InsufficientStockError(item.name, remaining, quantity, item.unit)
  }

  return transaction(() => {
    let purchased = Number(item.qty_purchased)
    let used = Number(item.qty_used)
    if (txnType === 'PURCHASE') purchased += quantity
    else if (txnType === 'USAGE' || txnType === 'WASTAGE') used += quantity
    else purchased += quantity // ADJUSTMENT: signed via reason, added to purchased side

    const balanceAfter = Number(item.opening_qty) + purchased - used

    updateRow('inventory_items', itemId, {
      ...updateEnvelope(item.version),
      qty_purchased: purchased,
      qty_used: used,
    })

    const txnId = insertRow('inventory_transactions', {
      ...insertEnvelope(),
      item_id: itemId,
      project_id: item.project_id,
      txn_type: txnType,
      quantity,
      balance_after: balanceAfter,
      reason: nullIfBlank(reason),
      station_id: stationId,
      occurred_at: nowIso(),
      actor: auditActor().username,
      is_demo: 0,
    })

    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'inventory_item',
      entityId: itemId,
      summary: `${txnType} of ${quantity} ${item.unit} recorded for ${item.name}`,
      previousValue: { remaining },
      newValue: { remaining: balanceAfter },
    })
    return txnId
  })
}

export interface InventoryTransaction {
  id: number
  item_id: number
  txn_type: string
  quantity: number
  balance_after: number | null
  reason: string | null
  occurred_at: string
  actor: string | null
}

export function transactionsFor(itemId: number): InventoryTransaction[] {
  return findAll<InventoryTransaction>(
    'inventory_transactions',
    'item_id = ?',
    [itemId],
    'occurred_at DESC, id DESC',
  )
}

export function inventoryAlerts(projectId: number): {
  lowStock: InventoryItem[]
  outOfStock: InventoryItem[]
  expiringSoon: InventoryItem[]
  expired: InventoryItem[]
} {
  const items = listInventory(projectId)
  return {
    lowStock: items.filter((i) => stockState(i) === 'LOW_STOCK'),
    outOfStock: items.filter((i) => stockState(i) === 'OUT_OF_STOCK'),
    expiringSoon: items.filter((i) => expiryState(i) === 'EXPIRING_SOON'),
    expired: items.filter((i) => expiryState(i) === 'EXPIRED'),
  }
}

export function inventoryAlertCount(projectId: number): number {
  const a = inventoryAlerts(projectId)
  return a.lowStock.length + a.outOfStock.length + a.expiringSoon.length + a.expired.length
}

export function deleteInventoryItem(id: number): void {
  softDelete('inventory_items', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'inventory_item',
    entityId: id,
    summary: 'Inventory item removed',
  })
}

// ----------------------------------------------------------- suppliers

export interface Supplier {
  id: number
  project_id: number | null
  name: string
  contact_person: string | null
  phone: string | null
  address: string | null
  notes: string | null
  is_active: number
  version: number
}

export function listSuppliers(): Supplier[] {
  return findAll<Supplier>('suppliers', '', [], 'name')
}

export function saveSupplier(
  data: Partial<Supplier> & { name: string },
  id?: number,
  projectId?: number,
): number {
  if (id) {
    const before = queryOne<Supplier>('SELECT * FROM suppliers WHERE id = ?', [id])
    updateRow('suppliers', id, {
      ...updateEnvelope(before?.version),
      name: data.name,
      contact_person: nullIfBlank(data.contact_person),
      phone: nullIfBlank(data.phone),
      address: nullIfBlank(data.address),
      notes: nullIfBlank(data.notes),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'supplier',
      entityId: id,
      summary: `Supplier updated: ${data.name}`,
    })
    return id
  }
  const newId = insertRow('suppliers', {
    ...insertEnvelope(),
    project_id: projectId ?? null,
    name: data.name,
    contact_person: nullIfBlank(data.contact_person),
    phone: nullIfBlank(data.phone),
    address: nullIfBlank(data.address),
    notes: nullIfBlank(data.notes),
    is_active: 1,
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'supplier',
    entityId: newId,
    summary: `Supplier added: ${data.name}`,
  })
  return newId
}

// --------------------------------------------------------- procurement

export interface Procurement {
  id: number
  project_id: number
  code: string | null
  item_name: string
  inventory_item_id: number | null
  quantity: number
  unit: string | null
  estimated_cost: number | null
  actual_cost: number | null
  supplier_id: number | null
  request_date: string | null
  approved_by: string | null
  approval_date: string | null
  purchase_date: string | null
  delivery_status: string
  payment_status: string
  status: string
  budget_category_id: number | null
  notes: string | null
  version: number
}

export interface ProcurementInput {
  itemName: string
  inventoryItemId?: number | null
  quantity: number
  unit?: string
  estimatedCost?: number | null
  actualCost?: number | null
  supplierId?: number | null
  requestDate?: string
  budgetCategoryId?: number | null
  notes?: string
}

export async function createProcurement(
  projectId: number,
  prefix: string,
  input: ProcurementInput,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    const serial =
      count('SELECT COUNT(*) AS c FROM procurement WHERE project_id = ?', [projectId]) + 1
    const id = insertRow('procurement', {
      ...insertEnvelope(),
      project_id: projectId,
      code: procurementCode(prefix, serial),
      item_name: input.itemName.trim(),
      inventory_item_id: input.inventoryItemId ?? null,
      quantity: input.quantity,
      unit: nullIfBlank(input.unit),
      estimated_cost: input.estimatedCost ?? null,
      actual_cost: input.actualCost ?? null,
      supplier_id: input.supplierId ?? null,
      request_date: input.requestDate ?? today(),
      delivery_status: 'PENDING',
      payment_status: 'UNPAID',
      status: 'REQUESTED',
      budget_category_id: input.budgetCategoryId ?? null,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'procurement',
      entityId: id,
      summary: `Procurement request created: ${input.itemName}`,
    })
    return id
  })
}

export function listProcurement(projectId: number, status?: string): Procurement[] {
  const clause = status ? 'project_id = ? AND status = ?' : 'project_id = ?'
  const params = status ? [projectId, status] : [projectId]
  return findAll<Procurement>('procurement', clause, params, 'request_date DESC, id DESC')
}

export async function updateProcurement(
  id: number,
  patch: Partial<Procurement>,
): Promise<void> {
  const before = queryOne<Procurement>('SELECT * FROM procurement WHERE id = ?', [id])
  if (!before) throw new Error('That procurement record no longer exists.')

  await transaction(() => {
    updateRow('procurement', id, {
      ...updateEnvelope(before.version),
      item_name: patch.item_name ?? before.item_name,
      quantity: patch.quantity ?? before.quantity,
      unit: patch.unit !== undefined ? nullIfBlank(patch.unit) : before.unit,
      estimated_cost:
        patch.estimated_cost !== undefined ? patch.estimated_cost : before.estimated_cost,
      actual_cost: patch.actual_cost !== undefined ? patch.actual_cost : before.actual_cost,
      supplier_id: patch.supplier_id !== undefined ? patch.supplier_id : before.supplier_id,
      approved_by: patch.approved_by ?? before.approved_by,
      approval_date: patch.approval_date ?? before.approval_date,
      purchase_date: patch.purchase_date ?? before.purchase_date,
      delivery_status: patch.delivery_status ?? before.delivery_status,
      payment_status: patch.payment_status ?? before.payment_status,
      status: patch.status ?? before.status,
      budget_category_id:
        patch.budget_category_id !== undefined
          ? patch.budget_category_id
          : before.budget_category_id,
      notes: patch.notes !== undefined ? nullIfBlank(patch.notes) : before.notes,
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'procurement',
      entityId: id,
      summary: `Procurement ${before.code ?? id} updated`,
      previousValue: { status: before.status },
      newValue: { status: patch.status ?? before.status },
    })
  })
}

/**
 * Marks a procurement received and adds the quantity to inventory stock in
 * the same transaction, so the two can never disagree.
 */
export async function receiveProcurement(
  id: number,
  actualCost: number | null,
  linkInventoryItemId?: number,
): Promise<void> {
  const proc = queryOne<Procurement>('SELECT * FROM procurement WHERE id = ?', [id])
  if (!proc) throw new Error('That procurement record no longer exists.')
  const itemId = linkInventoryItemId ?? proc.inventory_item_id

  await transaction(() => {
    updateRow('procurement', id, {
      ...updateEnvelope(proc.version),
      status: 'RECEIVED',
      delivery_status: 'DELIVERED',
      purchase_date: proc.purchase_date ?? today(),
      actual_cost: actualCost ?? proc.actual_cost,
      inventory_item_id: itemId ?? null,
    })

    if (itemId) {
      const item = getInventoryItem(itemId)
      if (item) {
        const purchased = Number(item.qty_purchased) + Number(proc.quantity)
        updateRow('inventory_items', itemId, {
          ...updateEnvelope(item.version),
          qty_purchased: purchased,
        })
        insertRow('inventory_transactions', {
          ...insertEnvelope(),
          item_id: itemId,
          project_id: proc.project_id,
          txn_type: 'PURCHASE',
          quantity: proc.quantity,
          balance_after: Number(item.opening_qty) + purchased - Number(item.qty_used),
          reason: `Received against ${proc.code ?? `procurement ${id}`}`,
          occurred_at: nowIso(),
          actor: auditActor().username,
          is_demo: 0,
        })
      }
    }

    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'procurement',
      entityId: id,
      summary: `Procurement ${proc.code ?? id} received`,
      previousValue: { status: proc.status },
      newValue: { status: 'RECEIVED', actualCost },
    })
  })
}

export function procurementTotals(projectId: number): {
  requested: number
  estimated: number
  actual: number
  outstanding: number
} {
  const row = queryOne<{ n: number; est: number; act: number; outstanding: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(estimated_cost), 0) AS est,
            COALESCE(SUM(actual_cost), 0) AS act,
            SUM(CASE WHEN status NOT IN ('RECEIVED','CANCELLED') THEN 1 ELSE 0 END) AS outstanding
       FROM procurement WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  )
  return {
    requested: Number(row?.n ?? 0),
    estimated: Number(row?.est ?? 0),
    actual: Number(row?.act ?? 0),
    outstanding: Number(row?.outstanding ?? 0),
  }
}

export function inventoryValuation(projectId: number): number {
  const rows = listInventory(projectId)
  return rows.reduce((sum, i) => sum + remainingQty(i) * Number(i.unit_cost ?? 0), 0)
}

export function inventoryReconciliation(projectId: number): {
  item: InventoryItem
  remaining: number
  state: StockState
  expiry: ExpiryState
}[] {
  return listInventory(projectId).map((item) => ({
    item,
    remaining: remainingQty(item),
    state: stockState(item),
    expiry: expiryState(item),
  }))
}

export function recentStockMovements(projectId: number, limit = 50): (InventoryTransaction & {
  item_name: string
  unit: string
})[] {
  return query(
    `SELECT t.*, i.name AS item_name, i.unit
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.item_id
      WHERE t.project_id = ? AND t.deleted_at IS NULL
      ORDER BY t.occurred_at DESC, t.id DESC LIMIT ?`,
    [projectId, limit],
  )
}
