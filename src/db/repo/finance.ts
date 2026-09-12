/** Budget categories, budget lines and expenses (spec S35). */
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
import { today } from '../../core/datetime'

export interface BudgetCategory {
  id: number
  project_id: number
  name: string
  sort_order: number
}

export interface BudgetItem {
  id: number
  project_id: number
  category_id: number
  description: string
  budget_amount: number
  committed_amount: number
  notes: string | null
  version: number
}

export interface Expense {
  id: number
  project_id: number
  category_id: number | null
  budget_item_id: number | null
  procurement_id: number | null
  description: string
  amount: number
  spent_at: string
  paid_to: string | null
  receipt_ref: string | null
  recorded_by: string | null
  notes: string | null
  version: number
}

export function listBudgetCategories(projectId: number): BudgetCategory[] {
  return findAll<BudgetCategory>(
    'budget_categories',
    'project_id = ?',
    [projectId],
    'sort_order, name',
  )
}

export function addBudgetCategory(projectId: number, name: string): number {
  const order = count(
    'SELECT COALESCE(MAX(sort_order), 0) AS c FROM budget_categories WHERE project_id = ?',
    [projectId],
  )
  const id = insertRow('budget_categories', {
    ...insertEnvelope(),
    project_id: projectId,
    name,
    sort_order: order + 1,
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'budget_category',
    entityId: id,
    summary: `Budget category added: ${name}`,
  })
  return id
}

export async function saveBudgetItem(
  projectId: number,
  data: {
    categoryId: number
    description: string
    budgetAmount: number
    committedAmount?: number
    notes?: string
  },
  id?: number,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    if (id) {
      const before = queryOne<BudgetItem>('SELECT * FROM budget_items WHERE id = ?', [id])
      updateRow('budget_items', id, {
        ...updateEnvelope(before?.version),
        category_id: data.categoryId,
        description: data.description,
        budget_amount: data.budgetAmount,
        committed_amount: data.committedAmount ?? before?.committed_amount ?? 0,
        notes: nullIfBlank(data.notes),
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'budget_item',
        entityId: id,
        summary: `Budget line updated: ${data.description}`,
        previousValue: { budget: before?.budget_amount },
        newValue: { budget: data.budgetAmount },
      })
      return id
    }
    const newId = insertRow('budget_items', {
      ...insertEnvelope(),
      project_id: projectId,
      category_id: data.categoryId,
      description: data.description,
      budget_amount: data.budgetAmount,
      committed_amount: data.committedAmount ?? 0,
      notes: nullIfBlank(data.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'budget_item',
      entityId: newId,
      summary: `Budget line added: ${data.description}`,
    })
    return newId
  })
}

export function listBudgetItems(projectId: number): (BudgetItem & { category_name: string })[] {
  return query(
    `SELECT b.*, c.name AS category_name
       FROM budget_items b JOIN budget_categories c ON c.id = b.category_id
      WHERE b.project_id = ? AND b.deleted_at IS NULL
      ORDER BY c.sort_order, b.description`,
    [projectId],
  )
}

export function deleteBudgetItem(id: number): void {
  softDelete('budget_items', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'budget_item',
    entityId: id,
    summary: 'Budget line removed',
  })
}

export async function recordExpense(
  projectId: number,
  data: {
    categoryId: number | null
    budgetItemId?: number | null
    procurementId?: number | null
    description: string
    amount: number
    spentAt?: string
    paidTo?: string
    receiptRef?: string
    notes?: string
  },
  isDemo = false,
): Promise<number> {
  if (!Number.isFinite(data.amount) || data.amount < 0) {
    throw new Error('The amount must be a positive number.')
  }
  return transaction(() => {
    const id = insertRow('expenses', {
      ...insertEnvelope(),
      project_id: projectId,
      category_id: data.categoryId,
      budget_item_id: data.budgetItemId ?? null,
      procurement_id: data.procurementId ?? null,
      description: data.description.trim(),
      amount: data.amount,
      spent_at: data.spentAt ?? today(),
      paid_to: nullIfBlank(data.paidTo),
      receipt_ref: nullIfBlank(data.receiptRef),
      recorded_by: auditActor().username,
      notes: nullIfBlank(data.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'expense',
      entityId: id,
      summary: `Expense recorded: ${data.description}`,
      newValue: { amount: data.amount },
    })
    return id
  })
}

export function listExpenses(projectId: number): (Expense & { category_name: string | null })[] {
  return query(
    `SELECT e.*, c.name AS category_name
       FROM expenses e LEFT JOIN budget_categories c ON c.id = e.category_id
      WHERE e.project_id = ? AND e.deleted_at IS NULL
      ORDER BY e.spent_at DESC, e.id DESC`,
    [projectId],
  )
}

export function deleteExpense(id: number): void {
  softDelete('expenses', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'expense',
    entityId: id,
    summary: 'Expense removed',
  })
}

export interface BudgetLine {
  categoryId: number
  category: string
  budget: number
  committed: number
  spent: number
  balance: number
}

/** Budget / committed / spent / balance per category (spec S35). */
export function budgetSummary(projectId: number): {
  lines: BudgetLine[]
  totals: { budget: number; committed: number; spent: number; balance: number }
} {
  const categories = listBudgetCategories(projectId)

  const budgets = new Map<number, { budget: number; committed: number }>()
  for (const r of query<{ category_id: number; b: number; c: number }>(
    `SELECT category_id, COALESCE(SUM(budget_amount), 0) AS b,
            COALESCE(SUM(committed_amount), 0) AS c
       FROM budget_items WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY category_id`,
    [projectId],
  )) {
    budgets.set(Number(r.category_id), { budget: Number(r.b), committed: Number(r.c) })
  }

  const spends = new Map<number, number>()
  for (const r of query<{ category_id: number | null; s: number }>(
    `SELECT category_id, COALESCE(SUM(amount), 0) AS s
       FROM expenses WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY category_id`,
    [projectId],
  )) {
    if (r.category_id !== null) spends.set(Number(r.category_id), Number(r.s))
  }

  const lines: BudgetLine[] = categories.map((c) => {
    const b = budgets.get(c.id) ?? { budget: 0, committed: 0 }
    const spent = spends.get(c.id) ?? 0
    return {
      categoryId: c.id,
      category: c.name,
      budget: b.budget,
      committed: b.committed,
      spent,
      balance: b.budget - spent,
    }
  })

  const totals = lines.reduce(
    (acc, l) => ({
      budget: acc.budget + l.budget,
      committed: acc.committed + l.committed,
      spent: acc.spent + l.spent,
      balance: acc.balance + l.balance,
    }),
    { budget: 0, committed: 0, spent: 0, balance: 0 },
  )

  // Expenses not attached to any category still belong in the totals.
  const uncategorised = count(
    `SELECT COALESCE(SUM(amount), 0) AS c FROM expenses
      WHERE project_id = ? AND deleted_at IS NULL AND category_id IS NULL`,
    [projectId],
  )
  totals.spent += uncategorised
  totals.balance -= uncategorised

  return { lines, totals }
}

export function formatMoney(amount: number, currency = 'NGN'): string {
  const symbol = currency === 'NGN' ? '₦' : `${currency} `
  const n = Math.round(amount * 100) / 100
  return `${symbol}${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
