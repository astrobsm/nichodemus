/** Inventory, expiry, procurement, budget and analytics (spec S95, S96). */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDatabase, teardown, type Fixture } from './helpers'
import {
  ExpiredStockError,
  InsufficientStockError,
  createInventoryItem,
  createProcurement,
  expiryState,
  getInventoryItem,
  inventoryAlerts,
  receiveProcurement,
  recordStockMovement,
  remainingQty,
  stockState,
  transactionsFor,
} from '../src/db/repo/inventory'
import {
  budgetSummary,
  listBudgetCategories,
  recordExpense,
  saveBudgetItem,
} from '../src/db/repo/finance'
import { registerParticipant } from '../src/db/repo/participants'
import { recordVitals, recordGlucose } from '../src/db/repo/clinical'
import { createReferral } from '../src/db/repo/referrals'
import { dataQuality, demographics, reachStats, screeningStats, percent } from '../src/db/repo/analytics'
import { checklistProgress, listChecklist, listStations, toggleChecklistItem } from '../src/db/repo/projects'
import { addDays, today } from '../src/core/datetime'

let fx: Fixture

beforeEach(async () => {
  fx = await freshDatabase()
})

afterAll(teardown)

describe('project seeding', () => {
  it('creates the default stations, checklist and budget categories', () => {
    expect(listStations(fx.project.id).length).toBeGreaterThanOrEqual(9)
    expect(listChecklist(fx.project.id).length).toBeGreaterThanOrEqual(19)
    expect(listBudgetCategories(fx.project.id).length).toBeGreaterThanOrEqual(15)
  })

  it('tracks mandatory checklist completion', () => {
    const before = checklistProgress(fx.project.id)
    expect(before.mandatoryDone).toBe(0)
    expect(before.mandatoryTotal).toBeGreaterThan(0)

    const item = listChecklist(fx.project.id).find((c) => c.is_mandatory)!
    toggleChecklistItem(item.id, true, 'test.admin')
    expect(checklistProgress(fx.project.id).mandatoryDone).toBe(1)
  })
})

describe('inventory', () => {
  async function item(overrides: Record<string, unknown> = {}) {
    const id = await createInventoryItem(fx.project.id, {
      name: 'Glucometer strips',
      category: 'Glucose supplies',
      unit: 'strip',
      openingQty: 100,
      minStock: 20,
      ...overrides,
    } as never)
    return getInventoryItem(id)!
  }

  it('computes remaining stock as opening plus purchased minus used', async () => {
    const i = await item()
    await recordStockMovement(i.id, 'PURCHASE', 50, 'Delivery')
    await recordStockMovement(i.id, 'USAGE', 30, 'Used at glucose station')

    const after = getInventoryItem(i.id)!
    expect(remainingQty(after)).toBe(120)
    expect(transactionsFor(i.id)).toHaveLength(3) // opening + purchase + usage
  })

  it('marks low stock at or below the minimum, and zero as out of stock', async () => {
    const i = await item({ openingQty: 25, minStock: 20 })
    expect(stockState(getInventoryItem(i.id)!)).toBe('IN_STOCK')

    await recordStockMovement(i.id, 'USAGE', 5, 'Used')
    expect(stockState(getInventoryItem(i.id)!)).toBe('LOW_STOCK')

    await recordStockMovement(i.id, 'USAGE', 20, 'Used')
    expect(stockState(getInventoryItem(i.id)!)).toBe('OUT_OF_STOCK')
    expect(remainingQty(getInventoryItem(i.id)!)).toBe(0)
  })

  it('refuses to issue more than is in stock', async () => {
    const i = await item({ openingQty: 10 })
    await expect(recordStockMovement(i.id, 'USAGE', 11, 'Too many')).rejects.toBeInstanceOf(
      InsufficientStockError,
    )
    expect(remainingQty(getInventoryItem(i.id)!)).toBe(10)
  })

  it('refuses to issue expired stock', async () => {
    const i = await item({ expiryDate: addDays(today(), -1) })
    expect(expiryState(getInventoryItem(i.id)!)).toBe('EXPIRED')
    await expect(recordStockMovement(i.id, 'USAGE', 1, 'Use')).rejects.toBeInstanceOf(
      ExpiredStockError,
    )
    // Wastage is still allowed so the stock can be written off.
    await expect(recordStockMovement(i.id, 'WASTAGE', 1, 'Expired')).resolves.toBeTypeOf('number')
  })

  it('flags stock that is expiring soon', async () => {
    await item({ name: 'Soon', expiryDate: addDays(today(), 20) })
    await item({ name: 'Later', expiryDate: addDays(today(), 400) })
    const alerts = inventoryAlerts(fx.project.id)
    expect(alerts.expiringSoon.map((i) => i.name)).toEqual(['Soon'])
    expect(alerts.expired).toHaveLength(0)
  })

  it('rejects a zero or negative quantity', async () => {
    const i = await item()
    await expect(recordStockMovement(i.id, 'USAGE', 0, 'None')).rejects.toThrow(/positive number/i)
    await expect(recordStockMovement(i.id, 'USAGE', -5, 'Negative')).rejects.toThrow(/positive number/i)
  })
})

describe('procurement', () => {
  it('adds received quantity to the linked inventory item', async () => {
    const itemId = await createInventoryItem(fx.project.id, {
      name: 'Gauze',
      category: 'Wound care supplies',
      unit: 'pack',
      openingQty: 10,
    })
    const procId = await createProcurement(fx.project.id, fx.project.participant_prefix, {
      itemName: 'Gauze',
      quantity: 40,
      inventoryItemId: itemId,
      estimatedCost: 12000,
    })

    await receiveProcurement(procId, 11500)

    const item = getInventoryItem(itemId)!
    expect(remainingQty(item)).toBe(50)
    expect(transactionsFor(itemId).some((t) => t.txn_type === 'PURCHASE')).toBe(true)
  })
})

describe('budget', () => {
  it('reports budget, spend and balance per category', async () => {
    const categories = listBudgetCategories(fx.project.id)
    const medical = categories.find((c) => c.name === 'Medical supplies')!

    await saveBudgetItem(fx.project.id, {
      categoryId: medical.id,
      description: 'Test strips and lancets',
      budgetAmount: 150000,
    })
    await recordExpense(fx.project.id, {
      categoryId: medical.id,
      description: 'Strips purchased',
      amount: 90000,
    })

    const summary = budgetSummary(fx.project.id)
    const line = summary.lines.find((l) => l.categoryId === medical.id)!
    expect(line.budget).toBe(150000)
    expect(line.spent).toBe(90000)
    expect(line.balance).toBe(60000)
    expect(summary.totals.spent).toBe(90000)
  })

  it('rejects a negative expense', async () => {
    await expect(
      recordExpense(fx.project.id, { categoryId: null, description: 'Bad', amount: -5 }),
    ).rejects.toThrow(/positive number/i)
  })
})

describe('analytics', () => {
  beforeEach(async () => {
    // Three participants: two screened, one of them with an elevated BP.
    for (let i = 0; i < 3; i++) {
      const p = await registerParticipant(
        fx.project,
        {
          firstName: `Person${i}`,
          lastName: `Test${i}`,
          sex: i === 0 ? 'MALE' : 'FEMALE',
          ageYears: 30 + i * 15,
          consentStatus: 'GIVEN',
        },
        { overrideDuplicate: true },
      )
      if (i < 2) {
        await recordVitals(
          p.id,
          fx.project.id,
          { systolic: i === 0 ? 118 : 172, diastolic: i === 0 ? 74 : 98 },
          fx.thresholds,
        )
        await recordGlucose(
          p.id,
          fx.project.id,
          { value: 5.2, unit: 'mmol/L', fastingStatus: 'NON_FASTING' },
          fx.thresholds,
        )
      }
      if (i === 1) {
        await createReferral(
          p.id,
          fx.project.id,
          fx.project.participant_prefix,
          { reason: 'Elevated blood pressure screening measurement', urgency: 'PRIORITY' },
          fx.thresholds,
        )
      }
    }
  })

  it('derives reach directly from the database', () => {
    const reach = reachStats(fx.project.id, fx.project.expected_participants)
    expect(reach.registered).toBe(3)
    expect(reach.screened).toBe(2)
    expect(reach.expected).toBe(500)
  })

  it('counts people, not readings, as having an elevated screening finding', async () => {
    const p = (await registerParticipant(
      fx.project,
      { firstName: 'Repeat', lastName: 'Reading', sex: 'FEMALE', ageYears: 60, consentStatus: 'GIVEN' },
      { overrideDuplicate: true },
    ))!
    await recordVitals(p.id, fx.project.id, { systolic: 175, diastolic: 100 }, fx.thresholds)
    await recordVitals(p.id, fx.project.id, { systolic: 168, diastolic: 96 }, fx.thresholds)
    await recordVitals(p.id, fx.project.id, { systolic: 162, diastolic: 94 }, fx.thresholds)

    const s = screeningStats(fx.project.id)
    expect(s.bpReadings).toBe(5) // 2 from the fixture + 3 repeats
    expect(s.bpElevated).toBe(2) // two people, not four readings
    expect(s.bpRepeated).toBe(1)
  })

  it('produces demographics with age bands that sum to the recorded total', () => {
    const d = demographics(fx.project.id)
    const banded = d.ageBands.reduce((sum, b) => sum + b.count, 0)
    expect(banded + d.ageNotRecorded).toBe(d.total)
    expect(d.female + d.male).toBe(d.total)
  })

  it('reports data quality gaps', () => {
    const q = dataQuality(fx.project.id)
    expect(q.totalParticipants).toBe(3)
    expect(q.missingBp).toBe(1)
    expect(q.missingClinicalReview).toBe(3)
    expect(q.issues.some((i) => i.label === 'Missing blood pressure')).toBe(true)
  })

  it('rounds percentages sensibly and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33.3)
    expect(percent(0, 0)).toBe(0)
    expect(percent(2, 4)).toBe(50)
  })
})
