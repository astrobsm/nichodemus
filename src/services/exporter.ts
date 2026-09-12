/**
 * CSV / spreadsheet export (spec S46).
 *
 * Datasets marked identifiable are only produced for users holding the
 * reports.identifiable permission; everyone else gets the de-identified
 * variant, which replaces names and phone numbers with the participant code.
 */
import { query, transaction } from '../db/sqlite'
import { audit, AUDIT_ACTIONS } from '../core/audit'
import { filenameStamp } from '../core/datetime'
import { saveFile } from './fileIo'

export interface DatasetDefinition {
  key: string
  label: string
  filename: string
  identifiable: boolean
  description: string
  sql: (projectId: number, identifiable: boolean) => string
}

const participantSelect = (identifiable: boolean) =>
  identifiable
    ? `p.participant_code, p.first_name, p.middle_name, p.last_name, p.phone,`
    : `p.participant_code,`

export const DATASETS: DatasetDefinition[] = [
  {
    key: 'participants',
    label: 'Participants',
    filename: 'participants.csv',
    identifiable: true,
    description: 'One row per registered participant.',
    sql: (_p, id) => `
      SELECT ${participantSelect(id)}
             p.sex, p.age_years, p.age_is_estimated, p.community, p.occupation,
             p.known_hypertension, p.known_diabetes, p.previous_breast_problem,
             p.workflow_status, p.registered_at, p.completed_at
        FROM participants p
       WHERE p.project_id = ? AND p.deleted_at IS NULL
       ORDER BY p.serial_no`,
  },
  {
    key: 'screening',
    label: 'Screening measurements',
    filename: 'screening.csv',
    identifiable: false,
    description: 'Blood pressure and glucose screening results.',
    sql: () => `
      SELECT p.participant_code, p.sex, p.age_years,
             'Blood pressure' AS measurement, v.reading_index AS sequence,
             v.bp_systolic AS value_1, v.bp_diastolic AS value_2, v.pulse AS value_3,
             NULL AS unit, NULL AS fasting_status,
             v.alert_level, v.recorded_at AS recorded_at, v.recorded_by AS recorded_by
        FROM vitals v JOIN participants p ON p.id = v.participant_id
       WHERE v.project_id = ? AND v.deleted_at IS NULL
       UNION ALL
      SELECT p.participant_code, p.sex, p.age_years,
             'Blood glucose', 1,
             g.value, g.value_mmol, NULL,
             g.unit, g.fasting_status,
             g.alert_level, g.tested_at, g.operator
        FROM glucose_results g JOIN participants p ON p.id = g.participant_id
       WHERE g.project_id = ? AND g.deleted_at IS NULL
       ORDER BY participant_code, recorded_at`,
  },
  {
    key: 'vitals',
    label: 'Vital signs',
    filename: 'vitals.csv',
    identifiable: false,
    description: 'Every vital signs reading including repeat measurements.',
    sql: () => `
      SELECT p.participant_code, p.sex, p.age_years, v.reading_index,
             v.bp_systolic, v.bp_diastolic, v.pulse, v.weight_kg, v.height_cm, v.bmi,
             v.temperature_c, v.spo2, v.arm, v.posture, v.alert_level,
             v.recorded_at, v.recorded_by
        FROM vitals v JOIN participants p ON p.id = v.participant_id
       WHERE v.project_id = ? AND v.deleted_at IS NULL
       ORDER BY p.serial_no, v.reading_index`,
  },
  {
    key: 'glucose',
    label: 'Glucose results',
    filename: 'glucose.csv',
    identifiable: false,
    description: 'Capillary glucose screening results.',
    sql: () => `
      SELECT p.participant_code, p.sex, p.age_years, g.test_type, g.fasting_status,
             g.value, g.unit, g.value_mmol, g.device_label, g.strip_lot,
             g.alert_level, g.tested_at, g.operator
        FROM glucose_results g JOIN participants p ON p.id = g.participant_id
       WHERE g.project_id = ? AND g.deleted_at IS NULL
       ORDER BY p.serial_no, g.tested_at`,
  },
  {
    key: 'wounds',
    label: 'Wound assessments',
    filename: 'wounds.csv',
    identifiable: false,
    description: 'Wound records and their assessments.',
    sql: () => `
      SELECT p.participant_code, w.wound_code, w.location, w.side, w.cause, w.duration_text,
             a.assessed_at, a.length_cm, a.width_cm, a.depth_cm, a.area_cm2,
             a.tissue_type, a.exudate_amount, a.exudate_type, a.odour, a.wound_edge,
             a.surrounding_skin, a.infection_signs, a.pain_score, a.swelling, a.necrosis,
             a.dressing_applied, a.dressing_type, a.next_dressing_date,
             a.referral_required, a.alert_level, a.assessed_by
        FROM wound_assessments a
        JOIN wounds w ON w.id = a.wound_id
        JOIN participants p ON p.id = a.participant_id
       WHERE a.project_id = ? AND a.deleted_at IS NULL
       ORDER BY p.serial_no, a.assessed_at`,
  },
  {
    key: 'breast_assessments',
    label: 'Breast examinations',
    filename: 'breast_assessments.csv',
    identifiable: false,
    description: 'Breast health examination records.',
    sql: () => `
      SELECT p.participant_code, p.age_years, b.examined_at, b.breast_examined,
             b.chaperone_present, b.no_abnormality, b.lump_present, b.lump_side,
             b.lump_location, b.lump_size_mm, b.lump_mobility, b.lump_consistency,
             b.lump_tenderness, b.nipple_discharge, b.skin_change, b.nipple_change,
             b.axillary_finding, b.pain, b.other_finding, b.bse_taught,
             b.referral_required, b.alert_level, b.examiner
        FROM breast_examinations b JOIN participants p ON p.id = b.participant_id
       WHERE b.project_id = ? AND b.deleted_at IS NULL
       ORDER BY p.serial_no, b.examined_at`,
  },
  {
    key: 'clinical',
    label: 'Clinical consultations',
    filename: 'clinical_encounters.csv',
    identifiable: false,
    description: 'Clinical consultation records.',
    sql: () => `
      SELECT p.participant_code, p.sex, p.age_years, e.encounter_at, e.clinician,
             e.presenting_concerns, e.examination, e.assessment, e.advice,
             e.treatment_given, e.counselling_given, e.referral_required, e.followup_required
        FROM clinical_encounters e JOIN participants p ON p.id = e.participant_id
       WHERE e.project_id = ? AND e.deleted_at IS NULL
       ORDER BY p.serial_no, e.encounter_at`,
  },
  {
    key: 'referrals',
    label: 'Referrals',
    filename: 'referrals.csv',
    identifiable: true,
    description: 'Referral records with destination and status.',
    sql: (_p, id) => `
      SELECT r.referral_code, ${id ? 'p.participant_code, p.first_name, p.last_name, p.phone,' : 'p.participant_code,'}
             p.sex, p.age_years, r.referral_date, r.reason, r.urgency, r.facility_name,
             r.referring_clinician, r.transport_required, r.status, r.status_updated_at,
             r.source_module, r.instructions
        FROM referrals r JOIN participants p ON p.id = r.participant_id
       WHERE r.project_id = ? AND r.deleted_at IS NULL
       ORDER BY r.referral_date`,
  },
  {
    key: 'followups',
    label: 'Follow-up',
    filename: 'followups.csv',
    identifiable: true,
    description: 'Follow-up queue with contact outcomes.',
    sql: (_p, id) => `
      SELECT ${id ? 'p.participant_code, p.first_name, p.last_name, p.phone,' : 'p.participant_code,'}
             r.referral_code, f.reason, f.due_date, f.contact_attempts, f.last_contact_at,
             f.contact_method, f.outcome, f.facility_attended, f.further_treatment,
             f.next_followup_date, f.closed_at
        FROM followups f
        JOIN participants p ON p.id = f.participant_id
        LEFT JOIN referrals r ON r.id = f.referral_id
       WHERE f.project_id = ? AND f.deleted_at IS NULL
       ORDER BY f.due_date`,
  },
  {
    key: 'inventory',
    label: 'Inventory',
    filename: 'inventory.csv',
    identifiable: false,
    description: 'Stock position for every inventory item.',
    sql: () => `
      SELECT i.name, i.category, i.unit, i.opening_qty, i.qty_purchased, i.qty_used,
             (i.opening_qty + i.qty_purchased - i.qty_used) AS remaining,
             i.min_stock, i.unit_cost, i.batch_number, i.expiry_date, s.name AS supplier
        FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.project_id = ? AND i.deleted_at IS NULL
       ORDER BY i.category, i.name`,
  },
  {
    key: 'inventory_transactions',
    label: 'Stock movements',
    filename: 'inventory_transactions.csv',
    identifiable: false,
    description: 'Every stock movement recorded.',
    sql: () => `
      SELECT i.name AS item, i.unit, t.txn_type, t.quantity, t.balance_after,
             t.reason, t.occurred_at, t.actor
        FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
       WHERE t.project_id = ? AND t.deleted_at IS NULL
       ORDER BY t.occurred_at`,
  },
  {
    key: 'procurement',
    label: 'Procurement',
    filename: 'procurement.csv',
    identifiable: false,
    description: 'Procurement requests and their status.',
    sql: () => `
      SELECT pr.code, pr.item_name, pr.quantity, pr.unit, pr.estimated_cost, pr.actual_cost,
             s.name AS supplier, pr.request_date, pr.approved_by, pr.approval_date,
             pr.purchase_date, pr.status, pr.delivery_status, pr.payment_status
        FROM procurement pr LEFT JOIN suppliers s ON s.id = pr.supplier_id
       WHERE pr.project_id = ? AND pr.deleted_at IS NULL
       ORDER BY pr.request_date`,
  },
  {
    key: 'financials',
    label: 'Financials',
    filename: 'financials.csv',
    identifiable: false,
    description: 'Expenses against budget categories.',
    sql: () => `
      SELECT e.spent_at, c.name AS category, e.description, e.amount, e.paid_to,
             e.receipt_ref, e.recorded_by
        FROM expenses e LEFT JOIN budget_categories c ON c.id = e.category_id
       WHERE e.project_id = ? AND e.deleted_at IS NULL
       ORDER BY e.spent_at`,
  },
  {
    key: 'team',
    label: 'Team and volunteers',
    filename: 'team.csv',
    identifiable: false,
    description: 'Team roster with roles and stations.',
    sql: () => `
      SELECT t.staff_code, t.full_name, t.role, t.professional_category, t.organisation,
             t.licence_number, s.name AS station, t.shift, t.status, t.is_volunteer
        FROM team_members t LEFT JOIN stations s ON s.id = t.assigned_station_id
       WHERE t.project_id = ? AND t.deleted_at IS NULL
       ORDER BY t.full_name`,
  },
  {
    key: 'tasks',
    label: 'Tasks',
    filename: 'tasks.csv',
    identifiable: false,
    description: 'Planning tasks with status and due dates.',
    sql: () => `
      SELECT code, title, category, assignee_name, priority, start_date, due_date,
             status, completed_at
        FROM tasks WHERE project_id = ? AND deleted_at IS NULL
       ORDER BY due_date`,
  },
  {
    key: 'audit',
    label: 'Audit trail',
    filename: 'audit_log.csv',
    identifiable: false,
    description: 'Complete audit trail for this device.',
    sql: () => `
      SELECT occurred_at, username, user_role, action, entity_type, entity_id,
             summary, previous_value, new_value, device_id
        FROM audit_logs WHERE project_id = ? OR project_id IS NULL
       ORDER BY occurred_at DESC`,
  },
]

/** RFC 4180 quoting, with a BOM so Excel opens UTF-8 correctly. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '﻿'
  const headers = Object.keys(rows[0])
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','))
  return `﻿${lines.join('\r\n')}`
}

function paramCountOf(sql: string): number {
  return (sql.match(/\?/g) ?? []).length
}

export function buildDataset(
  dataset: DatasetDefinition,
  projectId: number,
  identifiable: boolean,
): Record<string, unknown>[] {
  const sql = dataset.sql(projectId, identifiable && dataset.identifiable)
  const params = new Array(paramCountOf(sql)).fill(projectId)
  return query<Record<string, unknown>>(sql, params)
}

export async function exportDataset(
  dataset: DatasetDefinition,
  projectId: number,
  identifiable: boolean,
): Promise<{ rows: number; filename: string }> {
  const rows = buildDataset(dataset, projectId, identifiable)
  const csv = toCsv(rows)
  const filename = dataset.filename.replace('.csv', `-${filenameStamp()}.csv`)
  const outcome = await saveFile(csv, filename, 'text/csv', 'Comma separated values')
  if (!outcome.ok) {
    if (outcome.cancelled) throw new Error('Export cancelled. No file was written.')
    throw new Error(`The export file could not be written: ${outcome.error}`)
  }
  await transaction(() => {
    audit({
      action: AUDIT_ACTIONS.EXPORT,
      entityType: 'dataset',
      entityId: dataset.key,
      summary:
        `Exported ${rows.length} rows as ${outcome.name}` +
        (dataset.identifiable
          ? identifiable
            ? ' (including patient identifiers)'
            : ' (de-identified)'
          : ''),
    })
  })
  return { rows: rows.length, filename: outcome.name }
}
