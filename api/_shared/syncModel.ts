/**
 * The shape of what travels between a device and the cloud.
 *
 * Two problems have to be solved before a row can move between databases:
 *
 *   1. Primary keys are local autoincrement integers. Device A's participant
 *      12 is not device B's participant 12. Rows are therefore matched on
 *      `uuid`, which every record has carried since schema migration 001, and
 *      the local `id` is never transmitted.
 *
 *   2. Foreign keys are those same local integers. A vitals row pointing at
 *      participant_id = 12 is meaningless on another device. Every foreign
 *      key is therefore translated to the referenced row's uuid on the way
 *      out, and resolved back to a local id on the way in.
 */

/** Foreign key columns, and the table each one points at. */
export const FOREIGN_KEYS: Record<string, Record<string, string>> = {
  projects: {},
  stations: { project_id: 'projects' },
  team_members: { project_id: 'projects', assigned_station_id: 'stations' },
  attendance: {
    project_id: 'projects',
    team_member_id: 'team_members',
    station_id: 'stations',
  },
  tasks: { project_id: 'projects', assignee_id: 'team_members' },
  users: { team_member_id: 'team_members' },
  participants: { project_id: 'projects', current_station_id: 'stations' },
  consents: { participant_id: 'participants' },
  vitals: {
    participant_id: 'participants',
    project_id: 'projects',
    station_id: 'stations',
  },
  glucose_results: {
    participant_id: 'participants',
    project_id: 'projects',
    station_id: 'stations',
  },
  clinical_encounters: { participant_id: 'participants', project_id: 'projects' },
  wounds: { participant_id: 'participants', project_id: 'projects' },
  wound_assessments: {
    wound_id: 'wounds',
    participant_id: 'participants',
    project_id: 'projects',
  },
  breast_examinations: { participant_id: 'participants', project_id: 'projects' },
  facilities: { project_id: 'projects' },
  referrals: {
    participant_id: 'participants',
    project_id: 'projects',
    facility_id: 'facilities',
  },
  followups: {
    participant_id: 'participants',
    project_id: 'projects',
    referral_id: 'referrals',
  },
  queue_events: {
    participant_id: 'participants',
    project_id: 'projects',
    station_id: 'stations',
  },
  suppliers: { project_id: 'projects' },
  budget_categories: { project_id: 'projects' },
  budget_items: { project_id: 'projects', category_id: 'budget_categories' },
  expenses: {
    project_id: 'projects',
    category_id: 'budget_categories',
    budget_item_id: 'budget_items',
    procurement_id: 'procurement',
  },
  inventory_items: { project_id: 'projects', supplier_id: 'suppliers' },
  inventory_transactions: {
    item_id: 'inventory_items',
    project_id: 'projects',
    station_id: 'stations',
  },
  procurement: {
    project_id: 'projects',
    inventory_item_id: 'inventory_items',
    supplier_id: 'suppliers',
    budget_category_id: 'budget_categories',
  },
  mobilisation_activities: { project_id: 'projects' },
  logistics_items: { project_id: 'projects' },
  event_checklists: { project_id: 'projects' },
}

/**
 * Apply order. A row cannot be inserted before the rows it points at, so
 * parents come first. Anything whose parents are still missing is deferred
 * and retried, which covers the remaining edge cases (expenses referencing
 * procurement, which is defined after budget_categories).
 */
export const APPLY_ORDER = [
  'projects',
  'stations',
  'team_members',
  'users',
  'attendance',
  'tasks',
  'facilities',
  'suppliers',
  'budget_categories',
  'inventory_items',
  'procurement',
  'budget_items',
  'expenses',
  'inventory_transactions',
  'mobilisation_activities',
  'logistics_items',
  'event_checklists',
  'participants',
  'consents',
  'vitals',
  'glucose_results',
  'clinical_encounters',
  'wounds',
  'wound_assessments',
  'breast_examinations',
  'referrals',
  'followups',
  'queue_events',
]

/** Suffix marking a translated foreign key in a transmitted row. */
export const REF_SUFFIX = '__ref'

/** One record in transit. `row` holds every column except the local id. */
export interface SyncRecord {
  table: string
  uuid: string
  updated_at: string
  version: number
  deleted: boolean
  row: Record<string, unknown>
}

export interface PushRequest {
  action: 'push'
  deviceId: string
  records: SyncRecord[]
}

export interface PullRequest {
  action: 'pull'
  deviceId: string
  cursor: number
  limit?: number
}

export interface PushResponse {
  ok: true
  accepted: number
  rejected: { uuid: string; reason: string }[]
  cursor: number
  /** Another device has already reserved this device's number block. */
  blockConflict?: boolean
}

export interface PullResponse {
  ok: true
  records: (SyncRecord & { seq: number })[]
  cursor: number
  more: boolean
  blockConflict?: boolean
}

export interface SyncErrorResponse {
  ok: false
  error: string
}

/**
 * Last-write-wins, decided the same way on both sides so a device and the
 * server never disagree about who won.
 *
 * Higher version wins. Equal versions fall back to the later updated_at, and
 * an exact tie is broken by uuid so the result is deterministic rather than
 * dependent on arrival order.
 */
export function incomingWins(
  incoming: { version: number; updated_at: string; uuid: string },
  existing: { version: number; updated_at: string; uuid: string } | null,
): boolean {
  if (!existing) return true
  if (incoming.version !== existing.version) return incoming.version > existing.version
  const a = Date.parse(incoming.updated_at)
  const b = Date.parse(existing.updated_at)
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a > b
  return incoming.uuid > existing.uuid
}
