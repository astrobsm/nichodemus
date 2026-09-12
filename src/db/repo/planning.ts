/** Tasks, team, attendance and community mobilisation (spec S12, S13, S36-S38). */
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
import { nowIso, today } from '../../core/datetime'
import { staffCode, taskCode } from '../../core/ids'

// ---------------------------------------------------------------- tasks

export interface Task {
  id: number
  project_id: number
  code: string | null
  title: string
  description: string | null
  category: string | null
  assignee_id: number | null
  assignee_name: string | null
  priority: string
  start_date: string | null
  due_date: string | null
  status: string
  completed_at: string | null
  notes: string | null
  version: number
}

export interface TaskInput {
  title: string
  description?: string
  category?: string
  assigneeId?: number | null
  assigneeName?: string
  priority?: string
  startDate?: string
  dueDate?: string
  status?: string
  notes?: string
}

export async function saveTask(
  projectId: number,
  prefix: string,
  input: TaskInput,
  id?: number,
  isDemo = false,
): Promise<number> {
  if (!input.title?.trim()) throw new Error('A task title is required.')

  return transaction(() => {
    const status = input.status ?? 'NOT_STARTED'
    if (id) {
      const before = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id])
      updateRow('tasks', id, {
        ...updateEnvelope(before?.version),
        title: input.title.trim(),
        description: nullIfBlank(input.description),
        category: nullIfBlank(input.category),
        assignee_id: input.assigneeId ?? null,
        assignee_name: nullIfBlank(input.assigneeName),
        priority: input.priority ?? before?.priority ?? 'MEDIUM',
        start_date: nullIfBlank(input.startDate),
        due_date: nullIfBlank(input.dueDate),
        status,
        completed_at:
          status === 'COMPLETED' ? before?.completed_at ?? nowIso() : null,
        notes: nullIfBlank(input.notes),
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'task',
        entityId: id,
        summary: `Task updated: ${input.title}`,
        previousValue: { status: before?.status },
        newValue: { status },
      })
      return id
    }

    const serial = count('SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?', [projectId]) + 1
    const newId = insertRow('tasks', {
      ...insertEnvelope(),
      project_id: projectId,
      code: taskCode(prefix, serial),
      title: input.title.trim(),
      description: nullIfBlank(input.description),
      category: nullIfBlank(input.category),
      assignee_id: input.assigneeId ?? null,
      assignee_name: nullIfBlank(input.assigneeName),
      priority: input.priority ?? 'MEDIUM',
      start_date: nullIfBlank(input.startDate),
      due_date: nullIfBlank(input.dueDate),
      status,
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'task',
      entityId: newId,
      summary: `Task created: ${input.title}`,
    })
    return newId
  })
}

export function listTasks(projectId: number, status?: string): Task[] {
  const clause = status ? 'project_id = ? AND status = ?' : 'project_id = ?'
  const params = status ? [projectId, status] : [projectId]
  return findAll<Task>(
    'tasks',
    clause,
    params,
    `CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
     due_date IS NULL, due_date`,
  )
}

export function deleteTask(id: number): void {
  softDelete('tasks', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'task',
    entityId: id,
    summary: 'Task removed',
  })
}

export function taskStats(projectId: number): {
  total: number
  completed: number
  inProgress: number
  overdue: number
  critical: number
} {
  const byStatus: Record<string, number> = {}
  for (const r of query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM tasks
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY status`,
    [projectId],
  )) {
    byStatus[r.status] = Number(r.c)
  }
  const overdue = count(
    `SELECT COUNT(*) AS c FROM tasks
      WHERE project_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL
        AND due_date < ? AND status NOT IN ('COMPLETED','CANCELLED')`,
    [projectId, today()],
  )
  const critical = count(
    `SELECT COUNT(*) AS c FROM tasks
      WHERE project_id = ? AND deleted_at IS NULL AND priority = 'CRITICAL'
        AND status NOT IN ('COMPLETED','CANCELLED')`,
    [projectId],
  )
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    completed: byStatus.COMPLETED ?? 0,
    inProgress: byStatus.IN_PROGRESS ?? 0,
    overdue,
    critical,
  }
}

// ----------------------------------------------------------------- team

export interface TeamMember {
  id: number
  project_id: number
  staff_code: string
  full_name: string
  role: string | null
  professional_category: string | null
  phone: string | null
  email: string | null
  organisation: string | null
  licence_number: string | null
  assigned_station_id: number | null
  shift: string | null
  status: string
  is_volunteer: number
  notes: string | null
  version: number
}

export interface TeamMemberInput {
  fullName: string
  role?: string
  professionalCategory?: string
  phone?: string
  email?: string
  organisation?: string
  licenceNumber?: string
  assignedStationId?: number | null
  shift?: string
  status?: string
  isVolunteer?: boolean
  notes?: string
}

export async function saveTeamMember(
  projectId: number,
  prefix: string,
  input: TeamMemberInput,
  id?: number,
  isDemo = false,
): Promise<number> {
  if (!input.fullName?.trim()) throw new Error('A name is required.')

  return transaction(() => {
    if (id) {
      const before = queryOne<TeamMember>('SELECT * FROM team_members WHERE id = ?', [id])
      updateRow('team_members', id, {
        ...updateEnvelope(before?.version),
        full_name: input.fullName.trim(),
        role: nullIfBlank(input.role),
        professional_category: nullIfBlank(input.professionalCategory),
        phone: nullIfBlank(input.phone),
        email: nullIfBlank(input.email),
        organisation: nullIfBlank(input.organisation),
        licence_number: nullIfBlank(input.licenceNumber),
        assigned_station_id: input.assignedStationId ?? null,
        shift: nullIfBlank(input.shift),
        status: input.status ?? before?.status ?? 'CONFIRMED',
        is_volunteer: boolInt(input.isVolunteer),
        notes: nullIfBlank(input.notes),
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'team_member',
        entityId: id,
        summary: `Team member updated: ${input.fullName}`,
      })
      return id
    }

    const serial =
      count('SELECT COUNT(*) AS c FROM team_members WHERE project_id = ?', [projectId]) + 1
    const newId = insertRow('team_members', {
      ...insertEnvelope(),
      project_id: projectId,
      staff_code: staffCode(prefix, serial),
      full_name: input.fullName.trim(),
      role: nullIfBlank(input.role),
      professional_category: nullIfBlank(input.professionalCategory),
      phone: nullIfBlank(input.phone),
      email: nullIfBlank(input.email),
      organisation: nullIfBlank(input.organisation),
      licence_number: nullIfBlank(input.licenceNumber),
      assigned_station_id: input.assignedStationId ?? null,
      shift: nullIfBlank(input.shift),
      status: input.status ?? 'CONFIRMED',
      is_volunteer: boolInt(input.isVolunteer),
      notes: nullIfBlank(input.notes),
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'team_member',
      entityId: newId,
      summary: `Team member added: ${input.fullName}`,
    })
    return newId
  })
}

export function listTeam(projectId: number, volunteersOnly?: boolean): TeamMember[] {
  let clause = 'project_id = ?'
  if (volunteersOnly === true) clause += ' AND is_volunteer = 1'
  if (volunteersOnly === false) clause += ' AND is_volunteer = 0'
  return findAll<TeamMember>('team_members', clause, [projectId], 'full_name')
}

export function deleteTeamMember(id: number): void {
  softDelete('team_members', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'team_member',
    entityId: id,
    summary: 'Team member removed',
  })
}

// ----------------------------------------------------------- attendance

export interface AttendanceRecord {
  id: number
  project_id: number
  team_member_id: number
  date: string
  time_in: string | null
  time_out: string | null
  station_id: number | null
  status: string
  notes: string | null
  version: number
}

export async function checkIn(
  projectId: number,
  teamMemberId: number,
  stationId: number | null,
  status = 'PRESENT',
): Promise<number> {
  const day = today()
  const existing = queryOne<AttendanceRecord>(
    `SELECT * FROM attendance
      WHERE project_id = ? AND team_member_id = ? AND date = ? AND deleted_at IS NULL`,
    [projectId, teamMemberId, day],
  )

  return transaction(() => {
    if (existing) {
      updateRow('attendance', existing.id, {
        ...updateEnvelope(existing.version),
        time_in: existing.time_in ?? nowIso(),
        station_id: stationId,
        status,
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'attendance',
        entityId: existing.id,
        summary: 'Attendance updated',
      })
      return existing.id
    }
    const id = insertRow('attendance', {
      ...insertEnvelope(),
      project_id: projectId,
      team_member_id: teamMemberId,
      date: day,
      time_in: nowIso(),
      station_id: stationId,
      status,
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'attendance',
      entityId: id,
      summary: 'Staff checked in',
    })
    return id
  })
}

export async function checkOut(attendanceId: number): Promise<void> {
  const rec = queryOne<AttendanceRecord>('SELECT * FROM attendance WHERE id = ?', [attendanceId])
  if (!rec) return
  await transaction(() => {
    updateRow('attendance', attendanceId, {
      ...updateEnvelope(rec.version),
      time_out: nowIso(),
    })
    audit({
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'attendance',
      entityId: attendanceId,
      summary: 'Staff checked out',
    })
  })
}

export function attendanceFor(
  projectId: number,
  date = today(),
): (AttendanceRecord & { full_name: string; role: string | null; staff_code: string })[] {
  return query(
    `SELECT a.*, t.full_name, t.role, t.staff_code
       FROM attendance a JOIN team_members t ON t.id = a.team_member_id
      WHERE a.project_id = ? AND a.date = ? AND a.deleted_at IS NULL
      ORDER BY t.full_name`,
    [projectId, date],
  )
}

export function attendanceSummary(
  projectId: number,
  date = today(),
): { present: number; absent: number; late: number; leftEarly: number; teamSize: number } {
  const rows = attendanceFor(projectId, date)
  return {
    present: rows.filter((r) => r.status === 'PRESENT').length,
    absent: rows.filter((r) => r.status === 'ABSENT').length,
    late: rows.filter((r) => r.status === 'LATE').length,
    leftEarly: rows.filter((r) => r.status === 'LEFT_EARLY').length,
    teamSize: count(
      'SELECT COUNT(*) AS c FROM team_members WHERE project_id = ? AND deleted_at IS NULL',
      [projectId],
    ),
  }
}

// -------------------------------------------------------- mobilisation

export interface MobilisationActivity {
  id: number
  project_id: number
  activity: string
  activity_type: string | null
  activity_date: string | null
  location: string | null
  organisation: string | null
  responsible_person: string | null
  expected_reach: number | null
  actual_reach: number | null
  cost: number | null
  status: string
  notes: string | null
  version: number
}

export interface MobilisationInput {
  activity: string
  activityType?: string
  activityDate?: string
  location?: string
  organisation?: string
  responsiblePerson?: string
  expectedReach?: number | null
  actualReach?: number | null
  cost?: number | null
  status?: string
  notes?: string
}

export async function saveMobilisation(
  projectId: number,
  input: MobilisationInput,
  id?: number,
  isDemo = false,
): Promise<number> {
  return transaction(() => {
    const payload = {
      activity: input.activity.trim(),
      activity_type: nullIfBlank(input.activityType),
      activity_date: nullIfBlank(input.activityDate),
      location: nullIfBlank(input.location),
      organisation: nullIfBlank(input.organisation),
      responsible_person: nullIfBlank(input.responsiblePerson),
      expected_reach: input.expectedReach ?? null,
      actual_reach: input.actualReach ?? null,
      cost: input.cost ?? null,
      status: input.status ?? 'PLANNED',
      notes: nullIfBlank(input.notes),
    }
    if (id) {
      const before = queryOne<MobilisationActivity>(
        'SELECT * FROM mobilisation_activities WHERE id = ?',
        [id],
      )
      updateRow('mobilisation_activities', id, {
        ...updateEnvelope(before?.version),
        ...payload,
      })
      audit({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: 'mobilisation_activity',
        entityId: id,
        summary: `Mobilisation activity updated: ${input.activity}`,
      })
      return id
    }
    const newId = insertRow('mobilisation_activities', {
      ...insertEnvelope(),
      project_id: projectId,
      ...payload,
      is_demo: boolInt(isDemo),
    })
    audit({
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'mobilisation_activity',
      entityId: newId,
      summary: `Mobilisation activity added: ${input.activity}`,
    })
    return newId
  })
}

export function listMobilisation(projectId: number): MobilisationActivity[] {
  return findAll<MobilisationActivity>(
    'mobilisation_activities',
    'project_id = ?',
    [projectId],
    'activity_date IS NULL, activity_date DESC',
  )
}

export function deleteMobilisation(id: number): void {
  softDelete('mobilisation_activities', id)
  audit({
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'mobilisation_activity',
    entityId: id,
    summary: 'Mobilisation activity removed',
  })
}

export function mobilisationReach(projectId: number): { expected: number; actual: number; cost: number } {
  const row = queryOne<{ e: number; a: number; c: number }>(
    `SELECT COALESCE(SUM(expected_reach), 0) AS e,
            COALESCE(SUM(actual_reach), 0) AS a,
            COALESCE(SUM(cost), 0) AS c
       FROM mobilisation_activities WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  )
  return { expected: Number(row?.e ?? 0), actual: Number(row?.a ?? 0), cost: Number(row?.c ?? 0) }
}

/** Convenience for the team screen: who is assigned where. */
export function stationAssignments(
  projectId: number,
): { station_id: number | null; station_name: string | null; members: string[] }[] {
  const rows = query<{ station_id: number | null; station_name: string | null; full_name: string }>(
    `SELECT t.assigned_station_id AS station_id, s.name AS station_name, t.full_name
       FROM team_members t LEFT JOIN stations s ON s.id = t.assigned_station_id
      WHERE t.project_id = ? AND t.deleted_at IS NULL
      ORDER BY s.sort_order, t.full_name`,
    [projectId],
  )
  const map = new Map<string, { station_id: number | null; station_name: string | null; members: string[] }>()
  for (const r of rows) {
    const key = String(r.station_id ?? 'none')
    if (!map.has(key)) {
      map.set(key, { station_id: r.station_id, station_name: r.station_name, members: [] })
    }
    map.get(key)!.members.push(r.full_name)
  }
  return [...map.values()]
}

export function currentActorTeamMember(projectId: number): TeamMember | null {
  const name = auditActor().username
  return queryOne<TeamMember>(
    `SELECT * FROM team_members
      WHERE project_id = ? AND deleted_at IS NULL AND full_name = ? LIMIT 1`,
    [projectId, name],
  )
}
