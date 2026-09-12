/** Project, station, checklist and logistics repository (spec S11, S30, S40). */
import { query, queryOne, count } from '../sqlite'
import {
  findAll,
  insertEnvelope,
  insertRow,
  nullIfBlank,
  softDelete,
  updateEnvelope,
  updateRow,
  boolInt,
  type Value,
} from './base'
import { audit, AUDIT_ACTIONS, diffFields } from '../../core/audit'
import { nowIso, today } from '../../core/datetime'
import {
  BUDGET_CATEGORIES,
  DEFAULT_CHECKLIST,
  DEFAULT_LOGISTICS,
  DEFAULT_STATIONS,
  SETTING_KEYS,
  type ProjectStatus,
} from '../../core/constants'
import { setSetting, getSetting } from './settings'

export interface Project {
  id: number
  uuid: string
  code: string
  name: string
  memorial_honouree: string | null
  location: string | null
  lga: string | null
  state: string | null
  country: string | null
  proposed_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  expected_participants: number
  max_capacity: number | null
  objectives: string | null
  theme: string | null
  status: ProjectStatus
  project_director: string | null
  medical_director: string | null
  participant_prefix: string
  currency: string
  is_active: number
  is_demo: number
  closed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface Station {
  id: number
  project_id: number
  code: string
  name: string
  stage: string
  sort_order: number
  is_active: number
  notes: string | null
}

export interface ChecklistItem {
  id: number
  project_id: number
  title: string
  category: string | null
  sort_order: number
  is_mandatory: number
  is_done: number
  done_at: string | null
  done_by: string | null
  notes: string | null
}

export interface LogisticsItem {
  id: number
  project_id: number
  name: string
  category: string | null
  quantity_needed: string | null
  status: string
  responsible_person: string | null
  phone: string | null
  cost: number | null
  notes: string | null
  version: number
}

export interface NewProjectInput {
  name: string
  memorialHonouree?: string
  location?: string
  lga?: string
  state?: string
  proposedDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  expectedParticipants?: number
  maxCapacity?: number | null
  objectives?: string
  theme?: string
  projectDirector?: string
  medicalDirector?: string
  participantPrefix?: string
  currency?: string
  notes?: string
  isDemo?: boolean
}

/**
 * Derived from the project's own uuid rather than a local counter.
 *
 * A counter produces PRJ-001 on every device that runs the setup wizard, and
 * the codes collide the moment those devices sync. Deriving from the uuid
 * makes the code unique by construction, wherever it was created.
 */
function projectCodeFrom(projectUuid: string): string {
  return `PRJ-${projectUuid.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

/**
 * Creates a project together with its default stations, event checklist,
 * logistics list and budget categories, so the outreach is usable the
 * moment the first-run wizard finishes.
 */
export function createProject(input: NewProjectInput): number {
  const env = insertEnvelope()
  const prefix = (input.participantPrefix || 'NUG').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = insertRow('projects', {
    ...env,
    code: projectCodeFrom(env.uuid as string),
    name: input.name,
    memorial_honouree: nullIfBlank(input.memorialHonouree),
    location: nullIfBlank(input.location),
    lga: nullIfBlank(input.lga),
    state: nullIfBlank(input.state),
    country: 'Nigeria',
    proposed_date: nullIfBlank(input.proposedDate),
    end_date: nullIfBlank(input.endDate),
    start_time: nullIfBlank(input.startTime),
    end_time: nullIfBlank(input.endTime),
    expected_participants: input.expectedParticipants ?? 0,
    max_capacity: input.maxCapacity ?? null,
    objectives: nullIfBlank(input.objectives),
    theme: nullIfBlank(input.theme),
    status: 'PLANNING',
    project_director: nullIfBlank(input.projectDirector),
    medical_director: nullIfBlank(input.medicalDirector),
    participant_prefix: prefix || 'NUG',
    currency: input.currency ?? 'NGN',
    is_active: 1,
    is_demo: boolInt(input.isDemo),
    notes: nullIfBlank(input.notes),
  })

  seedStations(id, Boolean(input.isDemo))
  seedChecklist(id, Boolean(input.isDemo))
  seedLogistics(id, Boolean(input.isDemo))
  seedBudgetCategories(id, Boolean(input.isDemo))

  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'project',
    entityId: id,
    summary: `Project "${input.name}" created`,
  })
  return id
}

export function seedStations(projectId: number, isDemo = false): void {
  DEFAULT_STATIONS.forEach((s, i) => {
    insertRow('stations', {
      ...insertEnvelope(),
      project_id: projectId,
      code: s.code,
      name: s.name,
      stage: s.stage,
      sort_order: i,
      is_active: 1,
    })
  })
  void isDemo
}

export function seedChecklist(projectId: number, isDemo = false): void {
  DEFAULT_CHECKLIST.forEach((c, i) => {
    insertRow('event_checklists', {
      ...insertEnvelope(),
      project_id: projectId,
      title: c.title,
      category: c.category,
      sort_order: i,
      is_mandatory: boolInt(c.mandatory),
      is_done: 0,
      is_demo: boolInt(isDemo),
    })
  })
}

export function seedLogistics(projectId: number, isDemo = false): void {
  DEFAULT_LOGISTICS.forEach((l) => {
    insertRow('logistics_items', {
      ...insertEnvelope(),
      project_id: projectId,
      name: l.name,
      category: l.category,
      status: 'REQUIRED',
      is_demo: boolInt(isDemo),
    })
  })
}

export function seedBudgetCategories(projectId: number, isDemo = false): void {
  BUDGET_CATEGORIES.forEach((name, i) => {
    insertRow('budget_categories', {
      ...insertEnvelope(),
      project_id: projectId,
      name,
      sort_order: i,
      is_demo: boolInt(isDemo),
    })
  })
}

export function listProjects(): Project[] {
  return findAll<Project>('projects', '', [], 'created_at DESC')
}

export function getProject(id: number): Project | null {
  return queryOne<Project>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id])
}

export function activeProject(): Project | null {
  const stored = getSetting(SETTING_KEYS.ACTIVE_PROJECT)
  if (stored) {
    const p = getProject(Number(stored))
    if (p) return p
  }
  return queryOne<Project>(
    `SELECT * FROM projects WHERE deleted_at IS NULL AND is_active = 1
      ORDER BY created_at DESC LIMIT 1`,
  )
}

export function setActiveProject(id: number): void {
  setSetting(SETTING_KEYS.ACTIVE_PROJECT, id)
}

const PROJECT_AUDIT_FIELDS: (keyof Project)[] = [
  'name', 'location', 'lga', 'state', 'proposed_date', 'expected_participants',
  'status', 'project_director', 'medical_director', 'theme', 'objectives',
]

export function updateProject(id: number, patch: Partial<Project>): void {
  const before = getProject(id)
  if (!before) throw new Error('That project no longer exists.')

  const data: Record<string, Value> = { ...updateEnvelope(before.version) }
  for (const [k, v] of Object.entries(patch)) {
    if (['id', 'uuid', 'created_at', 'version'].includes(k)) continue
    data[k] = (v ?? null) as Value
  }
  updateRow('projects', id, data)

  const after = getProject(id)
  if (after) {
    const d = diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, PROJECT_AUDIT_FIELDS as string[])
    if (d.changed.length) {
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'project',
        entityId: id,
        summary: `Project updated: ${d.changed.join(', ')}`,
        previousValue: d.previous,
        newValue: d.next,
      })
    }
  }
}

export function setProjectStatus(id: number, status: ProjectStatus): void {
  const before = getProject(id)
  updateProject(id, { status })
  audit({
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'project',
    entityId: id,
    summary: `Project status changed to ${status}`,
    previousValue: before?.status,
    newValue: status,
  })
}

export function closeProject(id: number, notes: string | null): void {
  const before = getProject(id)
  updateRow('projects', id, {
    ...updateEnvelope(before?.version),
    status: 'COMPLETED',
    closed_at: nowIso(),
    notes: notes ?? before?.notes ?? null,
  })
  audit({
    action: AUDIT_ACTIONS.PROJECT_CLOSE,
    entityType: 'project',
    entityId: id,
    summary: 'Outreach closed and marked COMPLETED',
    previousValue: before?.status,
    newValue: 'COMPLETED',
  })
}

// ------------------------------------------------------------- stations

export function listStations(projectId: number, activeOnly = true): Station[] {
  const clause = activeOnly ? 'project_id = ? AND is_active = 1' : 'project_id = ?'
  return findAll<Station>('stations', clause, [projectId], 'sort_order, id')
}

export function getStationByStage(projectId: number, stage: string): Station | null {
  return queryOne<Station>(
    `SELECT * FROM stations
      WHERE project_id = ? AND stage = ? AND deleted_at IS NULL AND is_active = 1
      ORDER BY sort_order LIMIT 1`,
    [projectId, stage],
  )
}

export function createStation(
  projectId: number,
  data: { code: string; name: string; stage: string; sortOrder?: number },
): number {
  const id = insertRow('stations', {
    ...insertEnvelope(),
    project_id: projectId,
    code: data.code.toUpperCase(),
    name: data.name,
    stage: data.stage,
    sort_order: data.sortOrder ?? 99,
    is_active: 1,
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'station',
    entityId: id,
    summary: `Station "${data.name}" created`,
  })
  return id
}

export function updateStation(id: number, patch: Partial<Station>): void {
  const before = queryOne<Station & { version: number }>(
    'SELECT * FROM stations WHERE id = ?',
    [id],
  )
  const data: Record<string, Value> = { ...updateEnvelope(before?.version) }
  for (const [k, v] of Object.entries(patch)) {
    if (['id', 'uuid', 'created_at', 'version'].includes(k)) continue
    data[k] = (v ?? null) as Value
  }
  updateRow('stations', id, data)
  audit({
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'station',
    entityId: id,
    summary: 'Station updated',
  })
}

export function deleteStation(id: number): void {
  softDelete('stations', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'station',
    entityId: id,
    summary: 'Station removed',
  })
}

// ------------------------------------------------------------ checklist

export function listChecklist(projectId: number): ChecklistItem[] {
  return findAll<ChecklistItem>(
    'event_checklists',
    'project_id = ?',
    [projectId],
    'sort_order, id',
  )
}

export function addChecklistItem(
  projectId: number,
  title: string,
  category: string | null,
  mandatory = false,
): number {
  const maxOrder = count(
    'SELECT COALESCE(MAX(sort_order), 0) AS c FROM event_checklists WHERE project_id = ?',
    [projectId],
  )
  const id = insertRow('event_checklists', {
    ...insertEnvelope(),
    project_id: projectId,
    title,
    category,
    sort_order: maxOrder + 1,
    is_mandatory: boolInt(mandatory),
    is_done: 0,
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'checklist_item',
    entityId: id,
    summary: `Checklist item added: ${title}`,
  })
  return id
}

export function toggleChecklistItem(id: number, done: boolean, by: string): void {
  updateRow('event_checklists', id, {
    is_done: boolInt(done),
    done_at: done ? nowIso() : null,
    done_by: done ? by : null,
    updated_at: nowIso(),
    updated_by: by,
  })
  audit({
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'checklist_item',
    entityId: id,
    summary: done ? 'Checklist item completed' : 'Checklist item reopened',
  })
}

export function deleteChecklistItem(id: number): void {
  softDelete('event_checklists', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'checklist_item',
    entityId: id,
    summary: 'Checklist item removed',
  })
}

export function checklistProgress(projectId: number): {
  total: number
  done: number
  mandatoryTotal: number
  mandatoryDone: number
} {
  const row = queryOne<{
    total: number
    done: number
    mandatory_total: number
    mandatory_done: number
  }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN is_done = 1 THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN is_mandatory = 1 THEN 1 ELSE 0 END) AS mandatory_total,
            SUM(CASE WHEN is_mandatory = 1 AND is_done = 1 THEN 1 ELSE 0 END) AS mandatory_done
       FROM event_checklists WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  )
  return {
    total: Number(row?.total ?? 0),
    done: Number(row?.done ?? 0),
    mandatoryTotal: Number(row?.mandatory_total ?? 0),
    mandatoryDone: Number(row?.mandatory_done ?? 0),
  }
}

// ------------------------------------------------------------ logistics

export function listLogistics(projectId: number): LogisticsItem[] {
  return findAll<LogisticsItem>('logistics_items', 'project_id = ?', [projectId], 'category, name')
}

export function saveLogisticsItem(
  projectId: number,
  data: Partial<LogisticsItem> & { name: string },
  id?: number,
): number {
  if (id) {
    const before = queryOne<LogisticsItem>('SELECT * FROM logistics_items WHERE id = ?', [id])
    updateRow('logistics_items', id, {
      ...updateEnvelope(before?.version),
      name: data.name,
      category: data.category ?? null,
      quantity_needed: nullIfBlank(data.quantity_needed),
      status: data.status ?? 'REQUIRED',
      responsible_person: nullIfBlank(data.responsible_person),
      phone: nullIfBlank(data.phone),
      cost: data.cost ?? null,
      notes: nullIfBlank(data.notes),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'logistics_item',
      entityId: id,
      summary: `Logistics item updated: ${data.name}`,
      newValue: { status: data.status },
    })
    return id
  }
  const newId = insertRow('logistics_items', {
    ...insertEnvelope(),
    project_id: projectId,
    name: data.name,
    category: data.category ?? null,
    quantity_needed: nullIfBlank(data.quantity_needed),
    status: data.status ?? 'REQUIRED',
    responsible_person: nullIfBlank(data.responsible_person),
    phone: nullIfBlank(data.phone),
    cost: data.cost ?? null,
    notes: nullIfBlank(data.notes),
  })
  audit({
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'logistics_item',
    entityId: newId,
    summary: `Logistics item added: ${data.name}`,
  })
  return newId
}

export function deleteLogisticsItem(id: number): void {
  softDelete('logistics_items', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'logistics_item',
    entityId: id,
    summary: 'Logistics item removed',
  })
}

/** True when the outreach is running today, used to surface the event dashboard. */
export function isEventDay(project: Project | null): boolean {
  if (!project) return false
  if (project.status === 'ACTIVE') return true
  const t = today()
  const start = project.proposed_date?.slice(0, 10)
  const end = (project.end_date || project.proposed_date)?.slice(0, 10)
  if (!start) return false
  return t >= start && t <= (end ?? start)
}

export function projectSummaryLine(p: Project | null): string {
  if (!p) return ''
  const parts = [p.location, p.lga ? `${p.lga} LGA` : null, p.state ? `${p.state} State` : null]
  return parts.filter(Boolean).join(', ')
}

export function countAllProjects(): number {
  return count('SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL')
}

export function listStationQueueCounts(projectId: number): { stage: string; total: number }[] {
  return query<{ stage: string; total: number }>(
    `SELECT workflow_status AS stage, COUNT(*) AS total
       FROM participants
      WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY workflow_status`,
    [projectId],
  )
}
