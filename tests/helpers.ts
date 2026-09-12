/** Shared test fixtures: a fresh in-memory database with one project. */
import { openDatabase, closeDatabase, setPersistence, transaction } from '../src/db/sqlite'
import { migrate } from '../src/db/migrations'
import { createProject, setActiveProject, type Project, getProject } from '../src/db/repo/projects'
import { loadThresholds } from '../src/db/repo/settings'
import { setAuditActor } from '../src/core/audit'
import { ROLES } from '../src/core/permissions'
import type { ClinicalThresholds } from '../src/core/clinicalRules'

export interface Fixture {
  project: Project
  thresholds: ClinicalThresholds
}

export async function freshDatabase(): Promise<Fixture> {
  setPersistence(false)
  await closeDatabase()
  await openDatabase()
  migrate()

  setAuditActor({ id: 1, username: 'test.admin', role: ROLES.ADMINISTRATOR })

  const projectId = await transaction(() =>
    createProject({
      name: 'Test Outreach',
      memorialHonouree: 'Nichodemus Ugbor',
      location: 'Umunna community, Umuhu village, Owelli Court',
      lga: 'Awgu',
      state: 'Enugu',
      proposedDate: '2026-12-29',
      expectedParticipants: 500,
      participantPrefix: 'NUG',
    }),
  )
  await transaction(() => setActiveProject(projectId))

  return { project: getProject(projectId)!, thresholds: loadThresholds() }
}

export async function teardown(): Promise<void> {
  await closeDatabase()
}
