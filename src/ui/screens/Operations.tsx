/** Operations: inventory, procurement, finance, tasks, team, logistics (S12-S13, S31-S40). */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import { navigate } from '../router'
import {
  AlertBox,
  Badge,
  Card,
  ChoiceGroup,
  EmptyState,
  KeyValue,
  Modal,
  NumberField,
  SelectField,
  Stat,
  Tabs,
  TextArea,
  TextField,
  Toggle,
  friendlyError,
  useToast,
} from '../components/ui'
import {
  createInventoryItem,
  expiryState,
  inventoryAlerts,
  listInventory,
  listSuppliers,
  recordStockMovement,
  remainingQty,
  saveSupplier,
  stockState,
  updateInventoryItem,
  createProcurement,
  listProcurement,
  receiveProcurement,
  updateProcurement,
  procurementTotals,
  recentStockMovements,
  type InventoryItem,
} from '../../db/repo/inventory'
import {
  budgetSummary,
  formatMoney,
  listBudgetCategories,
  listBudgetItems,
  listExpenses,
  recordExpense,
  saveBudgetItem,
} from '../../db/repo/finance'
import {
  attendanceFor,
  attendanceSummary,
  checkIn,
  checkOut,
  deleteTask,
  listMobilisation,
  listTasks,
  listTeam,
  saveMobilisation,
  saveTask,
  saveTeamMember,
  taskStats,
  type Task,
  type TeamMember,
} from '../../db/repo/planning'
import {
  listChecklist,
  listLogistics,
  listStations,
  addChecklistItem,
  toggleChecklistItem,
  saveLogisticsItem,
  checklistProgress,
} from '../../db/repo/projects'
import {
  INVENTORY_CATEGORIES,
  LOGISTICS_CATEGORIES,
  LOGISTICS_STATUSES,
  MOBILISATION_STATUSES,
  MOBILISATION_TYPES,
  PROCUREMENT_STATUSES,
  PROFESSIONAL_CATEGORIES,
  STAFF_ROLES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TEAM_STATUSES,
  labelFor,
} from '../../core/constants'
import { PERMISSIONS } from '../../core/permissions'
import { formatShortDate, today } from '../../core/datetime'

type Tab = 'inventory' | 'procurement' | 'finance' | 'tasks' | 'team' | 'logistics' | 'checklist' | 'mobilisation'

const TABS: { key: Tab; label: string; permission: string }[] = [
  { key: 'inventory', label: 'Inventory', permission: PERMISSIONS.INVENTORY_VIEW },
  { key: 'procurement', label: 'Procurement', permission: PERMISSIONS.PROCUREMENT_VIEW },
  { key: 'finance', label: 'Budget', permission: PERMISSIONS.FINANCE_VIEW },
  { key: 'tasks', label: 'Tasks', permission: PERMISSIONS.TASK_VIEW },
  { key: 'team', label: 'Team', permission: PERMISSIONS.TEAM_VIEW },
  { key: 'logistics', label: 'Logistics', permission: PERMISSIONS.PROJECT_VIEW },
  { key: 'checklist', label: 'Checklist', permission: PERMISSIONS.PROJECT_VIEW },
  { key: 'mobilisation', label: 'Mobilisation', permission: PERMISSIONS.PROJECT_VIEW },
]

export function OperationsScreen({ initial }: { initial?: string }) {
  const { project, can } = useApp()
  const allowed = TABS.filter((t) => can(t.permission))
  const [tab, setTab] = useState<Tab>(
    (initial as Tab) && allowed.some((t) => t.key === initial)
      ? (initial as Tab)
      : allowed[0]?.key ?? 'checklist',
  )

  if (!project) return <EmptyState glyph="□" title="No active project" />
  if (allowed.length === 0) {
    return <EmptyState glyph="□" title="No operations modules are available for your role" />
  }

  return (
    <>
      <Tabs
        active={tab}
        onChange={(k) => {
          setTab(k as Tab)
          navigate(`/operations/${k}`)
        }}
        tabs={allowed.map((t) => ({ key: t.key, label: t.label }))}
      />
      {tab === 'inventory' ? <InventoryPanel projectId={project.id} /> : null}
      {tab === 'procurement' ? <ProcurementPanel projectId={project.id} prefix={project.participant_prefix} currency={project.currency} /> : null}
      {tab === 'finance' ? <FinancePanel projectId={project.id} currency={project.currency} /> : null}
      {tab === 'tasks' ? <TasksPanel projectId={project.id} prefix={project.participant_prefix} /> : null}
      {tab === 'team' ? <TeamPanel projectId={project.id} prefix={project.participant_prefix} /> : null}
      {tab === 'logistics' ? <LogisticsPanel projectId={project.id} /> : null}
      {tab === 'checklist' ? <ChecklistPanel projectId={project.id} /> : null}
      {tab === 'mobilisation' ? <MobilisationPanel projectId={project.id} /> : null}
    </>
  )
}

// ---------------------------------------------------------- inventory

function stockBadge(item: InventoryItem) {
  const s = stockState(item)
  if (s === 'OUT_OF_STOCK') return <Badge tone="danger">Out of stock</Badge>
  if (s === 'LOW_STOCK') return <Badge tone="warn">Low stock</Badge>
  return <Badge tone="ok">In stock</Badge>
}

function expiryBadge(item: InventoryItem) {
  const e = expiryState(item)
  if (e === 'EXPIRED') return <Badge tone="danger">Expired</Badge>
  if (e === 'EXPIRING_SOON') return <Badge tone="warn">Expiring soon</Badge>
  return null
}

function InventoryPanel({ projectId }: { projectId: number }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const [category, setCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const [movement, setMovement] = useState<InventoryItem | null>(null)

  const items = useQuery(() => listInventory(projectId, category || undefined), [projectId, category])
  const alerts = useQuery(() => inventoryAlerts(projectId), [projectId])
  const movements = useQuery(() => recentStockMovements(projectId, 20), [projectId])
  const editable = can(PERMISSIONS.INVENTORY_EDIT)

  return (
    <>
      {alerts.expired.length > 0 ? (
        <AlertBox tone="danger" title={`${alerts.expired.length} item${alerts.expired.length === 1 ? '' : 's'} expired`}>
          Expired products must not be used. Record them as wastage and remove them from the
          station.
        </AlertBox>
      ) : null}
      {alerts.outOfStock.length > 0 ? (
        <AlertBox tone="warn" title={`${alerts.outOfStock.length} item${alerts.outOfStock.length === 1 ? '' : 's'} out of stock`}>
          {alerts.outOfStock.map((i) => i.name).join(', ')}
        </AlertBox>
      ) : null}

      <div className="btn-row">
        {editable ? (
          <button className="btn" onClick={() => setAdding(true)}>
            Add item
          </button>
        ) : null}
        <SelectField
          label=""
          value={category}
          onChange={setCategory}
          placeholder="All categories"
          options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState glyph="□" title="No inventory items yet">
          Add the supplies you will take to the outreach.
        </EmptyState>
      ) : (
        <Card flush>
          {items.map((i) => (
            <div key={i.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="primary">{i.name}</span>
                <span className="secondary">
                  {i.category} · {remainingQty(i)} {i.unit} remaining of{' '}
                  {Number(i.opening_qty) + Number(i.qty_purchased)} {i.unit}
                </span>
                <span className="secondary">
                  Used {i.qty_used} {i.unit} · minimum {i.min_stock} {i.unit}
                  {i.expiry_date ? ` · expires ${formatShortDate(i.expiry_date)}` : ''}
                  {i.batch_number ? ` · batch ${i.batch_number}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {stockBadge(i)}
                  {expiryBadge(i)}
                </span>
              </span>
              {editable ? (
                <button className="btn small" onClick={() => setMovement(i)}>
                  Stock
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {movements.length > 0 ? (
        <Card title="Recent stock movements">
          {movements.map((m) => (
            <KeyValue
              key={m.id}
              k={`${labelFor(m.txn_type)} · ${m.item_name}`}
              v={`${m.quantity} ${m.unit} → ${m.balance_after} ${m.unit}`}
            />
          ))}
        </Card>
      ) : null}

      {adding ? (
        <Modal title="Add inventory item" onClose={() => setAdding(false)}>
          <InventoryForm
            projectId={projectId}
            onSaved={() => {
              setAdding(false)
              refresh()
              toast('ok', 'Inventory item added.')
            }}
          />
        </Modal>
      ) : null}

      {movement ? (
        <Modal title={`Stock movement — ${movement.name}`} onClose={() => setMovement(null)}>
          <StockMovementForm
            item={movement}
            onSaved={() => {
              setMovement(null)
              refresh()
              toast('ok', 'Stock movement recorded.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function InventoryForm({ projectId, onSaved }: { projectId: number; onSaved: () => void }) {
  const toast = useToast()
  const suppliers = useQuery(() => listSuppliers(), [])
  const [name, setName] = useState('')
  const [category, setCategory] = useState(INVENTORY_CATEGORIES[0])
  const [unit, setUnit] = useState('unit')
  const [opening, setOpening] = useState('0')
  const [minStock, setMinStock] = useState('0')
  const [cost, setCost] = useState('')
  const [batch, setBatch] = useState('')
  const [expiry, setExpiry] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await createInventoryItem(projectId, {
        name,
        category,
        unit,
        openingQty: Number(opening) || 0,
        minStock: Number(minStock) || 0,
        unitCost: cost === '' ? null : Number(cost),
        batchNumber: batch,
        expiryDate: expiry,
        supplierId: supplierId ? Number(supplierId) : null,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The item could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Item name" value={name} onChange={setName} required autoFocus />
      <SelectField
        label="Category"
        value={category}
        onChange={setCategory}
        options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))}
      />
      <div className="row">
        <TextField label="Unit" value={unit} onChange={setUnit} help="box, strip, pair…" />
        <NumberField label="Opening quantity" value={opening} onChange={setOpening} />
      </div>
      <div className="row">
        <NumberField label="Minimum stock" value={minStock} onChange={setMinStock} />
        <NumberField label="Unit cost" value={cost} onChange={setCost} />
      </div>
      <TextField label="Batch or lot number" value={batch} onChange={setBatch} />
      <TextField label="Expiry date" type="date" value={expiry} onChange={setExpiry} />
      {suppliers.length ? (
        <SelectField
          label="Supplier"
          value={supplierId}
          onChange={setSupplierId}
          placeholder="Not specified"
          options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
        />
      ) : null}
      <button className="btn block" onClick={save} disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : 'Save item'}
      </button>
    </>
  )
}

function StockMovementForm({ item, onSaved }: { item: InventoryItem; onSaved: () => void }) {
  const toast = useToast()
  const [type, setType] = useState<'USAGE' | 'PURCHASE' | 'ADJUSTMENT' | 'WASTAGE'>('USAGE')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const remaining = remainingQty(item)

  async function save() {
    setBusy(true)
    try {
      await recordStockMovement(item.id, type, Number(quantity), reason)
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The stock movement could not be recorded.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <KeyValue k="Currently remaining" v={`${remaining} ${item.unit}`} />
      {expiryState(item) === 'EXPIRED' ? (
        <AlertBox tone="danger" title="This item has expired">
          It cannot be issued for use. Record it as wastage.
        </AlertBox>
      ) : null}
      <ChoiceGroup
        label="Movement type"
        value={type}
        onChange={(v) => setType(v as 'USAGE')}
        options={[
          { value: 'USAGE', label: 'Used' },
          { value: 'PURCHASE', label: 'Received' },
          { value: 'WASTAGE', label: 'Wastage' },
          { value: 'ADJUSTMENT', label: 'Adjustment' },
        ]}
      />
      <NumberField label="Quantity" unit={item.unit} value={quantity} onChange={setQuantity} required autoFocus />
      <TextField label="Reason" value={reason} onChange={setReason} />
      <button className="btn block" onClick={save} disabled={busy || !quantity}>
        {busy ? 'Saving…' : 'Record movement'}
      </button>
    </>
  )
}

// -------------------------------------------------------- procurement

function ProcurementPanel({
  projectId,
  prefix,
  currency,
}: {
  projectId: number
  prefix: string
  currency: string
}) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const rows = useQuery(() => listProcurement(projectId), [projectId])
  const totals = useQuery(() => procurementTotals(projectId), [projectId])
  const [adding, setAdding] = useState(false)
  const editable = can(PERMISSIONS.PROCUREMENT_EDIT)

  async function setStatus(id: number, status: string) {
    try {
      if (status === 'RECEIVED') await receiveProcurement(id, null)
      else await updateProcurement(id, { status })
      refresh()
      toast('ok', 'Procurement updated.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The procurement could not be updated.'))
    }
  }

  return (
    <>
      <div className="stat-grid">
        <Stat label="Requests" value={totals.requested} />
        <Stat label="Outstanding" value={totals.outstanding} tone={totals.outstanding > 0 ? 'warn' : undefined} />
        <Stat label="Estimated" value={formatMoney(totals.estimated, currency)} />
        <Stat label="Actual" value={formatMoney(totals.actual, currency)} />
      </div>

      {editable ? (
        <button className="btn block" onClick={() => setAdding(true)}>
          New procurement request
        </button>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState glyph="□" title="No procurement requests" />
      ) : (
        <Card flush>
          {rows.map((p) => (
            <div key={p.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="primary">{p.item_name}</span>
                <span className="secondary">
                  {p.code} · {p.quantity} {p.unit ?? ''} ·{' '}
                  {p.estimated_cost !== null ? formatMoney(p.estimated_cost, currency) : 'cost not set'}
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Badge tone={p.status === 'RECEIVED' ? 'ok' : p.status === 'CANCELLED' ? 'muted' : 'warn'}>
                    {labelFor(p.status)}
                  </Badge>
                  <Badge tone={p.payment_status === 'PAID' ? 'ok' : 'muted'}>{labelFor(p.payment_status)}</Badge>
                </span>
              </span>
              {editable && p.status !== 'RECEIVED' ? (
                <select
                  aria-label={`Status for ${p.item_name}`}
                  value={p.status}
                  onChange={(e) => void setStatus(p.id, e.target.value)}
                  style={{ maxWidth: 140 }}
                >
                  {PROCUREMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {labelFor(s)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {adding ? (
        <Modal title="New procurement request" onClose={() => setAdding(false)}>
          <ProcurementForm
            projectId={projectId}
            prefix={prefix}
            onSaved={() => {
              setAdding(false)
              refresh()
              toast('ok', 'Procurement request created.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function ProcurementForm({
  projectId,
  prefix,
  onSaved,
}: {
  projectId: number
  prefix: string
  onSaved: () => void
}) {
  const toast = useToast()
  const items = useQuery(() => listInventory(projectId), [projectId])
  const categories = useQuery(() => listBudgetCategories(projectId), [projectId])
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [estimate, setEstimate] = useState('')
  const [linked, setLinked] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await createProcurement(projectId, prefix, {
        itemName: name,
        quantity: Number(quantity) || 0,
        unit,
        estimatedCost: estimate === '' ? null : Number(estimate),
        inventoryItemId: linked ? Number(linked) : null,
        budgetCategoryId: categoryId ? Number(categoryId) : null,
        notes,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The request could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Item" value={name} onChange={setName} required autoFocus />
      <div className="row">
        <NumberField label="Quantity" value={quantity} onChange={setQuantity} />
        <TextField label="Unit" value={unit} onChange={setUnit} />
      </div>
      <NumberField label="Estimated cost" value={estimate} onChange={setEstimate} />
      {items.length ? (
        <SelectField
          label="Link to inventory item"
          value={linked}
          onChange={setLinked}
          placeholder="Not linked"
          options={items.map((i) => ({ value: String(i.id), label: i.name }))}
          help="When the delivery is received, the stock balance updates automatically."
        />
      ) : null}
      {categories.length ? (
        <SelectField
          label="Budget category"
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Not assigned"
          options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        />
      ) : null}
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      <button className="btn block" onClick={save} disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : 'Create request'}
      </button>
    </>
  )
}

// ------------------------------------------------------------ finance

function FinancePanel({ projectId, currency }: { projectId: number; currency: string }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const summary = useQuery(() => budgetSummary(projectId), [projectId])
  const expenses = useQuery(() => listExpenses(projectId), [projectId])
  const budgetItems = useQuery(() => listBudgetItems(projectId), [projectId])
  const categories = useQuery(() => listBudgetCategories(projectId), [projectId])
  const [addingBudget, setAddingBudget] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)
  const editable = can(PERMISSIONS.FINANCE_EDIT)

  return (
    <>
      <div className="stat-grid">
        <Stat label="Budget" value={formatMoney(summary.totals.budget, currency)} />
        <Stat label="Spent" value={formatMoney(summary.totals.spent, currency)} />
        <Stat
          label="Balance"
          value={formatMoney(summary.totals.balance, currency)}
          tone={summary.totals.balance < 0 ? 'danger' : 'ok'}
        />
      </div>

      {editable ? (
        <div className="btn-row">
          <button className="btn" onClick={() => setAddingBudget(true)}>
            Add budget line
          </button>
          <button className="btn secondary" onClick={() => setAddingExpense(true)}>
            Record expense
          </button>
        </div>
      ) : null}

      <Card title="Budget against expenditure" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Budget</th>
                <th className="num">Spent</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines
                .filter((l) => l.budget || l.spent)
                .map((l) => (
                  <tr key={l.categoryId}>
                    <td>{l.category}</td>
                    <td className="num">{formatMoney(l.budget, currency)}</td>
                    <td className="num">{formatMoney(l.spent, currency)}</td>
                    <td className="num" style={{ color: l.balance < 0 ? 'var(--danger)' : undefined }}>
                      {formatMoney(l.balance, currency)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      {budgetItems.length ? (
        <Card title="Budget lines">
          {budgetItems.map((b) => (
            <KeyValue
              key={b.id}
              k={`${b.category_name} — ${b.description}`}
              v={formatMoney(b.budget_amount, currency)}
            />
          ))}
        </Card>
      ) : null}

      {expenses.length ? (
        <Card title="Expenses">
          {expenses.slice(0, 40).map((e) => (
            <KeyValue
              key={e.id}
              k={`${formatShortDate(e.spent_at)} · ${e.description}`}
              v={formatMoney(e.amount, currency)}
            />
          ))}
        </Card>
      ) : (
        <EmptyState glyph="□" title="No expenses recorded" />
      )}

      {addingBudget ? (
        <Modal title="Add budget line" onClose={() => setAddingBudget(false)}>
          <BudgetLineForm
            projectId={projectId}
            categories={categories}
            onSaved={() => {
              setAddingBudget(false)
              refresh()
              toast('ok', 'Budget line saved.')
            }}
          />
        </Modal>
      ) : null}

      {addingExpense ? (
        <Modal title="Record expense" onClose={() => setAddingExpense(false)}>
          <ExpenseForm
            projectId={projectId}
            categories={categories}
            onSaved={() => {
              setAddingExpense(false)
              refresh()
              toast('ok', 'Expense recorded.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function BudgetLineForm({
  projectId,
  categories,
  onSaved,
}: {
  projectId: number
  categories: { id: number; name: string }[]
  onSaved: () => void
}) {
  const toast = useToast()
  const [categoryId, setCategoryId] = useState(categories[0] ? String(categories[0].id) : '')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await saveBudgetItem(projectId, {
        categoryId: Number(categoryId),
        description,
        budgetAmount: Number(amount) || 0,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The budget line could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SelectField
        label="Category"
        value={categoryId}
        onChange={setCategoryId}
        options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
      />
      <TextField label="Description" value={description} onChange={setDescription} required autoFocus />
      <NumberField label="Budget amount" value={amount} onChange={setAmount} required />
      <button className="btn block" onClick={save} disabled={busy || !description.trim() || !categoryId}>
        {busy ? 'Saving…' : 'Save budget line'}
      </button>
    </>
  )
}

function ExpenseForm({
  projectId,
  categories,
  onSaved,
}: {
  projectId: number
  categories: { id: number; name: string }[]
  onSaved: () => void
}) {
  const toast = useToast()
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [receipt, setReceipt] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await recordExpense(projectId, {
        categoryId: categoryId ? Number(categoryId) : null,
        description,
        amount: Number(amount) || 0,
        spentAt: date,
        paidTo,
        receiptRef: receipt,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The expense could not be recorded.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SelectField
        label="Category"
        value={categoryId}
        onChange={setCategoryId}
        placeholder="Not assigned"
        options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
      />
      <TextField label="Description" value={description} onChange={setDescription} required autoFocus />
      <NumberField label="Amount" value={amount} onChange={setAmount} required />
      <TextField label="Date" type="date" value={date} onChange={setDate} />
      <TextField label="Paid to" value={paidTo} onChange={setPaidTo} />
      <TextField label="Receipt reference" value={receipt} onChange={setReceipt} />
      <button className="btn block" onClick={save} disabled={busy || !description.trim() || !amount}>
        {busy ? 'Saving…' : 'Record expense'}
      </button>
    </>
  )
}

// -------------------------------------------------------------- tasks

function TasksPanel({ projectId, prefix }: { projectId: number; prefix: string }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Task | 'NEW' | null>(null)
  const tasks = useQuery(() => listTasks(projectId, status || undefined), [projectId, status])
  const stats = useQuery(() => taskStats(projectId), [projectId])
  const editable = can(PERMISSIONS.TASK_EDIT)

  async function quickStatus(task: Task, next: string) {
    try {
      await saveTask(projectId, prefix, { title: task.title, status: next }, task.id)
      refresh()
    } catch (err) {
      toast('danger', friendlyError(err, 'The task could not be updated.'))
    }
  }

  return (
    <>
      <div className="stat-grid">
        <Stat label="Tasks" value={stats.total} />
        <Stat label="Completed" value={stats.completed} tone="ok" />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'warn' : undefined} />
        <Stat label="Critical open" value={stats.critical} tone={stats.critical > 0 ? 'danger' : undefined} />
      </div>

      {editable ? (
        <button className="btn block" onClick={() => setEditing('NEW')}>
          Add task
        </button>
      ) : null}
      <SelectField
        label="Filter by status"
        value={status}
        onChange={setStatus}
        placeholder="All tasks"
        options={TASK_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
      />

      {tasks.length === 0 ? (
        <EmptyState glyph="□" title="No tasks" />
      ) : (
        <Card flush>
          {tasks.map((t) => {
            const overdue =
              t.due_date && t.due_date < today() && !['COMPLETED', 'CANCELLED'].includes(t.status)
            return (
              <div key={t.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="primary">{t.title}</span>
                  <span className="secondary">
                    {t.category ?? 'Uncategorised'}
                    {t.assignee_name ? ` · ${t.assignee_name}` : ''}
                    {t.due_date ? ` · due ${formatShortDate(t.due_date)}` : ''}
                  </span>
                  <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge tone={t.status === 'COMPLETED' ? 'ok' : overdue ? 'danger' : 'muted'}>
                      {labelFor(t.status)}
                    </Badge>
                    <Badge tone={t.priority === 'CRITICAL' ? 'danger' : t.priority === 'HIGH' ? 'warn' : 'info'}>
                      {labelFor(t.priority)}
                    </Badge>
                  </span>
                </span>
                {editable ? (
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {t.status !== 'COMPLETED' ? (
                      <button className="btn small" onClick={() => void quickStatus(t, 'COMPLETED')}>
                        Done
                      </button>
                    ) : null}
                    <button className="btn small secondary" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                  </span>
                ) : null}
              </div>
            )
          })}
        </Card>
      )}

      {editing ? (
        <Modal
          title={editing === 'NEW' ? 'Add task' : 'Edit task'}
          onClose={() => setEditing(null)}
        >
          <TaskForm
            projectId={projectId}
            prefix={prefix}
            task={editing === 'NEW' ? null : editing}
            onSaved={() => {
              setEditing(null)
              refresh()
              toast('ok', 'Task saved.')
            }}
            onDeleted={() => {
              setEditing(null)
              refresh()
              toast('ok', 'Task removed.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function TaskForm({
  projectId,
  prefix,
  task,
  onSaved,
  onDeleted,
}: {
  projectId: number
  prefix: string
  task: Task | null
  onSaved: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const team = useQuery(() => listTeam(projectId), [projectId])
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [category, setCategory] = useState(task?.category ?? TASK_CATEGORIES[0])
  const [assignee, setAssignee] = useState(task?.assignee_name ?? '')
  const [priority, setPriority] = useState(task?.priority ?? 'MEDIUM')
  const [status, setStatus] = useState(task?.status ?? 'NOT_STARTED')
  const [due, setDue] = useState(task?.due_date ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await saveTask(
        projectId,
        prefix,
        { title, description, category, assigneeName: assignee, priority, status, dueDate: due },
        task?.id,
      )
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The task could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Title" value={title} onChange={setTitle} required autoFocus />
      <TextArea label="Description" value={description} onChange={setDescription} />
      <SelectField
        label="Category"
        value={category}
        onChange={setCategory}
        options={TASK_CATEGORIES.map((c) => ({ value: c, label: c }))}
      />
      {team.length ? (
        <SelectField
          label="Assigned to"
          value={assignee}
          onChange={setAssignee}
          placeholder="Not assigned"
          options={team.map((t) => ({ value: t.full_name, label: t.full_name }))}
        />
      ) : (
        <TextField label="Assigned to" value={assignee} onChange={setAssignee} />
      )}
      <ChoiceGroup
        label="Priority"
        value={priority}
        onChange={setPriority}
        options={TASK_PRIORITIES.map((p) => ({ value: p, label: labelFor(p) }))}
      />
      <SelectField
        label="Status"
        value={status}
        onChange={setStatus}
        options={TASK_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
      />
      <TextField label="Due date" type="date" value={due} onChange={setDue} />
      <button className="btn block" onClick={save} disabled={busy || !title.trim()}>
        {busy ? 'Saving…' : 'Save task'}
      </button>
      {task ? (
        <button
          className="btn block danger secondary"
          style={{ marginTop: 10 }}
          onClick={() => {
            deleteTask(task.id)
            onDeleted()
          }}
        >
          Remove task
        </button>
      ) : null}
    </>
  )
}

// --------------------------------------------------------------- team

function TeamPanel({ projectId, prefix }: { projectId: number; prefix: string }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const [editing, setEditing] = useState<TeamMember | 'NEW' | null>(null)
  const team = useQuery(() => listTeam(projectId), [projectId])
  const attendance = useQuery(() => attendanceFor(projectId), [projectId])
  const summary = useQuery(() => attendanceSummary(projectId), [projectId])
  const editable = can(PERMISSIONS.TEAM_EDIT)

  const attendanceByMember = new Map(attendance.map((a) => [a.team_member_id, a]))

  async function toggleAttendance(member: TeamMember) {
    try {
      const record = attendanceByMember.get(member.id)
      if (record && !record.time_out) await checkOut(record.id)
      else await checkIn(projectId, member.id, member.assigned_station_id)
      refresh()
    } catch (err) {
      toast('danger', friendlyError(err, 'Attendance could not be recorded.'))
    }
  }

  return (
    <>
      <div className="stat-grid">
        <Stat label="Team size" value={summary.teamSize} />
        <Stat label="Present today" value={summary.present} tone="ok" />
        <Stat label="Volunteers" value={team.filter((t) => t.is_volunteer).length} />
      </div>

      {editable ? (
        <button className="btn block" onClick={() => setEditing('NEW')}>
          Add team member
        </button>
      ) : null}

      {team.length === 0 ? (
        <EmptyState glyph="□" title="No team members yet" />
      ) : (
        <Card flush>
          {team.map((m) => {
            const record = attendanceByMember.get(m.id)
            return (
              <div key={m.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="primary">{m.full_name}</span>
                  <span className="secondary">
                    {m.staff_code} · {m.role ?? 'Role not set'}
                    {m.organisation ? ` · ${m.organisation}` : ''}
                  </span>
                  <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge tone={m.status === 'CONFIRMED' ? 'ok' : 'muted'}>{labelFor(m.status)}</Badge>
                    {m.is_volunteer ? <Badge tone="info">Volunteer</Badge> : null}
                    {record ? (
                      <Badge tone={record.time_out ? 'muted' : 'ok'}>
                        {record.time_out ? 'Checked out' : 'Checked in'}
                      </Badge>
                    ) : null}
                  </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn small secondary" onClick={() => void toggleAttendance(m)}>
                    {record && !record.time_out ? 'Check out' : 'Check in'}
                  </button>
                  {editable ? (
                    <button className="btn small ghost" onClick={() => setEditing(m)}>
                      Edit
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </Card>
      )}

      {editing ? (
        <Modal
          title={editing === 'NEW' ? 'Add team member' : 'Edit team member'}
          onClose={() => setEditing(null)}
        >
          <TeamForm
            projectId={projectId}
            prefix={prefix}
            member={editing === 'NEW' ? null : editing}
            onSaved={() => {
              setEditing(null)
              refresh()
              toast('ok', 'Team member saved.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function TeamForm({
  projectId,
  prefix,
  member,
  onSaved,
}: {
  projectId: number
  prefix: string
  member: TeamMember | null
  onSaved: () => void
}) {
  const toast = useToast()
  const stations = useQuery(() => listStations(projectId), [projectId])
  const [name, setName] = useState(member?.full_name ?? '')
  const [role, setRole] = useState(member?.role ?? STAFF_ROLES[1])
  const [category, setCategory] = useState(member?.professional_category ?? PROFESSIONAL_CATEGORIES[0])
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [org, setOrg] = useState(member?.organisation ?? '')
  const [licence, setLicence] = useState(member?.licence_number ?? '')
  const [stationId, setStationId] = useState(member?.assigned_station_id ? String(member.assigned_station_id) : '')
  const [shift, setShift] = useState(member?.shift ?? '')
  const [status, setStatus] = useState(member?.status ?? 'CONFIRMED')
  const [volunteer, setVolunteer] = useState(Boolean(member?.is_volunteer))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await saveTeamMember(
        projectId,
        prefix,
        {
          fullName: name,
          role,
          professionalCategory: category,
          phone,
          email,
          organisation: org,
          licenceNumber: licence,
          assignedStationId: stationId ? Number(stationId) : null,
          shift,
          status,
          isVolunteer: volunteer,
        },
        member?.id,
      )
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The team member could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Full name" value={name} onChange={setName} required autoFocus />
      <SelectField label="Role" value={role} onChange={setRole} options={STAFF_ROLES.map((r) => ({ value: r, label: r }))} />
      <SelectField
        label="Professional category"
        value={category}
        onChange={setCategory}
        options={PROFESSIONAL_CATEGORIES.map((c) => ({ value: c, label: c }))}
      />
      <div className="row">
        <TextField label="Telephone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
        <TextField label="Email" value={email} onChange={setEmail} />
      </div>
      <TextField label="Organisation" value={org} onChange={setOrg} />
      <TextField
        label="Licence / registration number"
        value={licence}
        onChange={setLicence}
        help="Where the role requires professional registration."
      />
      <SelectField
        label="Assigned station"
        value={stationId}
        onChange={setStationId}
        placeholder="Not assigned"
        options={stations.map((s) => ({ value: String(s.id), label: s.name }))}
      />
      <TextField label="Shift" value={shift} onChange={setShift} />
      <SelectField
        label="Status"
        value={status}
        onChange={setStatus}
        options={TEAM_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
      />
      <Toggle label="Volunteer" checked={volunteer} onChange={setVolunteer} />
      <button className="btn block" onClick={save} disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : 'Save team member'}
      </button>
    </>
  )
}

// ---------------------------------------------------------- logistics

function LogisticsPanel({ projectId }: { projectId: number }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const items = useQuery(() => listLogistics(projectId), [projectId])
  const [editing, setEditing] = useState<number | 'NEW' | null>(null)
  const editable = can(PERMISSIONS.LOGISTICS_EDIT) || can(PERMISSIONS.PROJECT_EDIT)

  function setStatus(id: number, name: string, status: string) {
    try {
      saveLogisticsItem(projectId, { name, status }, id)
      refresh()
    } catch (err) {
      toast('danger', friendlyError(err, 'The logistics item could not be updated.'))
    }
  }

  const confirmed = items.filter((i) => i.status === 'CONFIRMED').length

  return (
    <>
      <div className="stat-grid">
        <Stat label="Logistics items" value={items.length} />
        <Stat label="Confirmed" value={confirmed} tone={confirmed === items.length ? 'ok' : 'warn'} />
      </div>

      {editable ? (
        <button className="btn block" onClick={() => setEditing('NEW')}>
          Add logistics item
        </button>
      ) : null}

      <Card flush>
        {items.map((i) => (
          <div key={i.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <span className="grow">
              <span className="primary">{i.name}</span>
              <span className="secondary">
                {i.category ?? ''}
                {i.responsible_person ? ` · ${i.responsible_person}` : ''}
                {i.phone ? ` · ${i.phone}` : ''}
              </span>
              <span style={{ marginTop: 6, display: 'block' }}>
                <Badge tone={i.status === 'CONFIRMED' ? 'ok' : i.status === 'NOT_CONFIRMED' ? 'danger' : 'warn'}>
                  {labelFor(i.status)}
                </Badge>
              </span>
            </span>
            {editable ? (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select
                  aria-label={`Status for ${i.name}`}
                  value={i.status}
                  onChange={(e) => setStatus(i.id, i.name, e.target.value)}
                  style={{ maxWidth: 150 }}
                >
                  {LOGISTICS_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {labelFor(s)}
                    </option>
                  ))}
                </select>
                <button className="btn small ghost" onClick={() => setEditing(i.id)}>
                  Details
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </Card>

      {editing ? (
        <Modal title="Logistics item" onClose={() => setEditing(null)}>
          <LogisticsForm
            projectId={projectId}
            item={editing === 'NEW' ? null : items.find((i) => i.id === editing) ?? null}
            onSaved={() => {
              setEditing(null)
              refresh()
              toast('ok', 'Logistics item saved.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function LogisticsForm({
  projectId,
  item,
  onSaved,
}: {
  projectId: number
  item: { id: number; name: string; category: string | null; quantity_needed: string | null; status: string; responsible_person: string | null; phone: string | null; cost: number | null; notes: string | null } | null
  onSaved: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? LOGISTICS_CATEGORIES[0])
  const [quantity, setQuantity] = useState(item?.quantity_needed ?? '')
  const [status, setStatus] = useState(item?.status ?? 'REQUIRED')
  const [person, setPerson] = useState(item?.responsible_person ?? '')
  const [phone, setPhone] = useState(item?.phone ?? '')
  const [cost, setCost] = useState(item?.cost ? String(item.cost) : '')
  const [notes, setNotes] = useState(item?.notes ?? '')

  function save() {
    try {
      saveLogisticsItem(
        projectId,
        {
          name,
          category,
          quantity_needed: quantity,
          status,
          responsible_person: person,
          phone,
          cost: cost === '' ? null : Number(cost),
          notes,
        },
        item?.id,
      )
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The item could not be saved.'))
    }
  }

  return (
    <>
      <TextField label="Item" value={name} onChange={setName} required autoFocus />
      <SelectField
        label="Category"
        value={category}
        onChange={setCategory}
        options={LOGISTICS_CATEGORIES.map((c) => ({ value: c, label: c }))}
      />
      <TextField label="Quantity needed" value={quantity} onChange={setQuantity} />
      <SelectField
        label="Status"
        value={status}
        onChange={setStatus}
        options={LOGISTICS_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
      />
      <TextField label="Responsible person" value={person} onChange={setPerson} />
      <TextField label="Telephone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
      <NumberField label="Cost" value={cost} onChange={setCost} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      <button className="btn block" onClick={save} disabled={!name.trim()}>
        Save
      </button>
    </>
  )
}

// ---------------------------------------------------------- checklist

function ChecklistPanel({ projectId }: { projectId: number }) {
  const { can, refresh, user } = useApp()
  const toast = useToast()
  const items = useQuery(() => listChecklist(projectId), [projectId])
  const progress = useQuery(() => checklistProgress(projectId), [projectId])
  const [newItem, setNewItem] = useState('')
  const editable = can(PERMISSIONS.CHECKLIST_EDIT) || can(PERMISSIONS.PROJECT_EDIT)

  function toggle(id: number, done: boolean) {
    try {
      toggleChecklistItem(id, done, user?.full_name ?? 'Unknown')
      refresh()
    } catch (err) {
      toast('danger', friendlyError(err, 'The checklist could not be updated.'))
    }
  }

  function add() {
    if (!newItem.trim()) return
    addChecklistItem(projectId, newItem.trim(), 'Custom', false)
    setNewItem('')
    refresh()
    toast('ok', 'Checklist item added.')
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
          <strong>
            {progress.done} of {progress.total} complete
          </strong>
          <span>{pct}%</span>
        </div>
        <div className="progress-track">
          <div className={`progress-fill ${pct === 100 ? 'ok' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        {progress.mandatoryDone < progress.mandatoryTotal ? (
          <div style={{ marginTop: 12 }}>
            <AlertBox tone="warn" title="Mandatory items outstanding">
              {progress.mandatoryTotal - progress.mandatoryDone} mandatory item
              {progress.mandatoryTotal - progress.mandatoryDone === 1 ? '' : 's'} must be completed
              before the outreach can be closed.
            </AlertBox>
          </div>
        ) : null}
      </Card>

      {editable ? (
        <Card tight>
          <div className="row">
            <TextField label="" value={newItem} onChange={setNewItem} placeholder="Add a checklist item" />
            <button className="btn" style={{ flex: '0 0 auto' }} onClick={add}>
              Add
            </button>
          </div>
        </Card>
      ) : null}

      <Card flush>
        {items.map((item) => (
          <div key={item.id} className="list-item" style={{ cursor: 'default' }}>
            <button
              className="choice"
              aria-pressed={Boolean(item.is_done)}
              onClick={() => editable && toggle(item.id, !item.is_done)}
              disabled={!editable}
              style={{ flex: 'none', minWidth: 46 }}
              aria-label={item.is_done ? `Mark ${item.title} incomplete` : `Mark ${item.title} complete`}
            >
              {item.is_done ? '' : '○'}
            </button>
            <span className="grow">
              <span
                className="primary"
                style={{
                  textDecoration: item.is_done ? 'line-through' : undefined,
                  color: item.is_done ? 'var(--muted)' : undefined,
                  whiteSpace: 'normal',
                }}
              >
                {item.title}
              </span>
              <span className="secondary">
                {item.category}
                {item.is_mandatory ? ' · mandatory' : ''}
                {item.done_by ? ` · ${item.done_by}` : ''}
              </span>
            </span>
          </div>
        ))}
      </Card>
    </>
  )
}

// -------------------------------------------------------- mobilisation

function MobilisationPanel({ projectId }: { projectId: number }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const rows = useQuery(() => listMobilisation(projectId), [projectId])
  const [adding, setAdding] = useState(false)
  const editable = can(PERMISSIONS.MOBILISATION_EDIT) || can(PERMISSIONS.PROJECT_EDIT)

  const expected = rows.reduce((s, r) => s + Number(r.expected_reach ?? 0), 0)
  const actual = rows.reduce((s, r) => s + Number(r.actual_reach ?? 0), 0)

  return (
    <>
      <div className="stat-grid">
        <Stat label="Expected reach" value={expected} />
        <Stat label="Actual reach" value={actual} tone={actual >= expected ? 'ok' : undefined} />
      </div>

      {editable ? (
        <button className="btn block" onClick={() => setAdding(true)}>
          Add mobilisation activity
        </button>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState glyph="□" title="No mobilisation activities recorded" />
      ) : (
        <Card flush>
          {rows.map((m) => (
            <div key={m.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="primary">{m.activity}</span>
                <span className="secondary">
                  {m.activity_type ?? ''}
                  {m.activity_date ? ` · ${formatShortDate(m.activity_date)}` : ''}
                  {m.responsible_person ? ` · ${m.responsible_person}` : ''}
                </span>
                <span className="secondary">
                  Expected {m.expected_reach ?? '—'} · reached {m.actual_reach ?? '—'}
                </span>
                <span style={{ marginTop: 6, display: 'block' }}>
                  <Badge tone={m.status === 'COMPLETED' ? 'ok' : 'warn'}>{labelFor(m.status)}</Badge>
                </span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {adding ? (
        <Modal title="Mobilisation activity" onClose={() => setAdding(false)}>
          <MobilisationForm
            projectId={projectId}
            onSaved={() => {
              setAdding(false)
              refresh()
              toast('ok', 'Mobilisation activity saved.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function MobilisationForm({ projectId, onSaved }: { projectId: number; onSaved: () => void }) {
  const toast = useToast()
  const [activity, setActivity] = useState('')
  const [type, setType] = useState(MOBILISATION_TYPES[0])
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [org, setOrg] = useState('')
  const [person, setPerson] = useState('')
  const [expected, setExpected] = useState('')
  const [actual, setActual] = useState('')
  const [cost, setCost] = useState('')
  const [status, setStatus] = useState('PLANNED')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await saveMobilisation(projectId, {
        activity,
        activityType: type,
        activityDate: date,
        location,
        organisation: org,
        responsiblePerson: person,
        expectedReach: expected === '' ? null : Number(expected),
        actualReach: actual === '' ? null : Number(actual),
        cost: cost === '' ? null : Number(cost),
        status,
      })
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The activity could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Activity" value={activity} onChange={setActivity} required autoFocus />
      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={MOBILISATION_TYPES.map((t) => ({ value: t, label: t }))}
      />
      <TextField label="Date" type="date" value={date} onChange={setDate} />
      <TextField label="Location" value={location} onChange={setLocation} />
      <TextField label="Organisation or group" value={org} onChange={setOrg} />
      <TextField label="Responsible person" value={person} onChange={setPerson} />
      <div className="row">
        <NumberField label="Expected reach" value={expected} onChange={setExpected} />
        <NumberField label="Actual reach" value={actual} onChange={setActual} />
      </div>
      <NumberField label="Cost" value={cost} onChange={setCost} />
      <SelectField
        label="Status"
        value={status}
        onChange={setStatus}
        options={MOBILISATION_STATUSES.map((s) => ({ value: s, label: labelFor(s) }))}
      />
      <button className="btn block" onClick={save} disabled={busy || !activity.trim()}>
        {busy ? 'Saving…' : 'Save activity'}
      </button>
    </>
  )
}

export { saveSupplier, updateInventoryItem }
