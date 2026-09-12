/**
 * Role-based access control (spec S14). Roles and permissions are seeded
 * into the database, but this file is the single source of truth used both
 * by the seeder and by every UI permission check.
 */

export const PERMISSIONS = {
  PROJECT_VIEW: 'project.view',
  PROJECT_EDIT: 'project.edit',
  PROJECT_CLOSE: 'project.close',
  TASK_VIEW: 'task.view',
  TASK_EDIT: 'task.edit',
  TEAM_VIEW: 'team.view',
  TEAM_EDIT: 'team.edit',
  USER_MANAGE: 'user.manage',
  PARTICIPANT_VIEW: 'participant.view',
  PARTICIPANT_CREATE: 'participant.create',
  PARTICIPANT_EDIT: 'participant.edit',
  PARTICIPANT_OVERRIDE_DUPLICATE: 'participant.override_duplicate',
  VITALS_RECORD: 'vitals.record',
  GLUCOSE_RECORD: 'glucose.record',
  CLINICAL_RECORD: 'clinical.record',
  WOUND_RECORD: 'wound.record',
  BREAST_RECORD: 'breast.record',
  REFERRAL_VIEW: 'referral.view',
  REFERRAL_CREATE: 'referral.create',
  REFERRAL_UPDATE: 'referral.update',
  FOLLOWUP_VIEW: 'followup.view',
  FOLLOWUP_MANAGE: 'followup.manage',
  QUEUE_MANAGE: 'queue.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_EDIT: 'inventory.edit',
  PROCUREMENT_VIEW: 'procurement.view',
  PROCUREMENT_EDIT: 'procurement.edit',
  FINANCE_VIEW: 'finance.view',
  FINANCE_EDIT: 'finance.edit',
  MOBILISATION_EDIT: 'mobilisation.edit',
  LOGISTICS_EDIT: 'logistics.edit',
  CHECKLIST_EDIT: 'checklist.edit',
  ANALYTICS_VIEW: 'analytics.view',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  REPORTS_IDENTIFIABLE: 'reports.identifiable',
  CONFIG_CLINICAL: 'config.clinical',
  SETTINGS_MANAGE: 'settings.manage',
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',
  AUDIT_VIEW: 'audit.view',
  DEMO_MANAGE: 'demo.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const PERMISSION_CATALOGUE: { code: Permission; name: string; category: string }[] = [
  { code: PERMISSIONS.PROJECT_VIEW, name: 'View project', category: 'Project' },
  { code: PERMISSIONS.PROJECT_EDIT, name: 'Edit project', category: 'Project' },
  { code: PERMISSIONS.PROJECT_CLOSE, name: 'Close outreach', category: 'Project' },
  { code: PERMISSIONS.TASK_VIEW, name: 'View tasks', category: 'Project' },
  { code: PERMISSIONS.TASK_EDIT, name: 'Manage tasks', category: 'Project' },
  { code: PERMISSIONS.TEAM_VIEW, name: 'View team', category: 'Team' },
  { code: PERMISSIONS.TEAM_EDIT, name: 'Manage team', category: 'Team' },
  { code: PERMISSIONS.USER_MANAGE, name: 'Manage user accounts', category: 'Security' },
  { code: PERMISSIONS.PARTICIPANT_VIEW, name: 'View participants', category: 'Participants' },
  { code: PERMISSIONS.PARTICIPANT_CREATE, name: 'Register participants', category: 'Participants' },
  { code: PERMISSIONS.PARTICIPANT_EDIT, name: 'Edit participants', category: 'Participants' },
  {
    code: PERMISSIONS.PARTICIPANT_OVERRIDE_DUPLICATE,
    name: 'Override duplicate warning',
    category: 'Participants',
  },
  { code: PERMISSIONS.VITALS_RECORD, name: 'Record vital signs', category: 'Clinical' },
  { code: PERMISSIONS.GLUCOSE_RECORD, name: 'Record glucose screening', category: 'Clinical' },
  { code: PERMISSIONS.CLINICAL_RECORD, name: 'Record clinical consultation', category: 'Clinical' },
  { code: PERMISSIONS.WOUND_RECORD, name: 'Record wound care', category: 'Clinical' },
  { code: PERMISSIONS.BREAST_RECORD, name: 'Record breast examination', category: 'Clinical' },
  { code: PERMISSIONS.REFERRAL_VIEW, name: 'View referrals', category: 'Referral' },
  { code: PERMISSIONS.REFERRAL_CREATE, name: 'Create referrals', category: 'Referral' },
  { code: PERMISSIONS.REFERRAL_UPDATE, name: 'Update referral status', category: 'Referral' },
  { code: PERMISSIONS.FOLLOWUP_VIEW, name: 'View follow-up queue', category: 'Referral' },
  { code: PERMISSIONS.FOLLOWUP_MANAGE, name: 'Manage follow-up', category: 'Referral' },
  { code: PERMISSIONS.QUEUE_MANAGE, name: 'Move participants between stations', category: 'Operations' },
  { code: PERMISSIONS.INVENTORY_VIEW, name: 'View inventory', category: 'Operations' },
  { code: PERMISSIONS.INVENTORY_EDIT, name: 'Manage inventory', category: 'Operations' },
  { code: PERMISSIONS.PROCUREMENT_VIEW, name: 'View procurement', category: 'Operations' },
  { code: PERMISSIONS.PROCUREMENT_EDIT, name: 'Manage procurement', category: 'Operations' },
  { code: PERMISSIONS.FINANCE_VIEW, name: 'View budget and expenses', category: 'Finance' },
  { code: PERMISSIONS.FINANCE_EDIT, name: 'Manage budget and expenses', category: 'Finance' },
  { code: PERMISSIONS.MOBILISATION_EDIT, name: 'Manage mobilisation', category: 'Operations' },
  { code: PERMISSIONS.LOGISTICS_EDIT, name: 'Manage logistics', category: 'Operations' },
  { code: PERMISSIONS.CHECKLIST_EDIT, name: 'Manage event checklist', category: 'Operations' },
  { code: PERMISSIONS.ANALYTICS_VIEW, name: 'View analytics', category: 'Reporting' },
  { code: PERMISSIONS.REPORTS_VIEW, name: 'View reports', category: 'Reporting' },
  { code: PERMISSIONS.REPORTS_EXPORT, name: 'Export data', category: 'Reporting' },
  {
    code: PERMISSIONS.REPORTS_IDENTIFIABLE,
    name: 'Export identifiable patient data',
    category: 'Reporting',
  },
  { code: PERMISSIONS.CONFIG_CLINICAL, name: 'Change clinical thresholds', category: 'Security' },
  { code: PERMISSIONS.SETTINGS_MANAGE, name: 'Change application settings', category: 'Security' },
  { code: PERMISSIONS.BACKUP_CREATE, name: 'Create backups', category: 'Security' },
  { code: PERMISSIONS.BACKUP_RESTORE, name: 'Restore backups', category: 'Security' },
  { code: PERMISSIONS.AUDIT_VIEW, name: 'View audit trail', category: 'Security' },
  { code: PERMISSIONS.DEMO_MANAGE, name: 'Manage demonstration data', category: 'Security' },
]

export const ROLES = {
  ADMINISTRATOR: 'ADMINISTRATOR',
  MEDICAL_DIRECTOR: 'MEDICAL_DIRECTOR',
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  LABORATORY: 'LABORATORY',
  BREAST_HEALTH: 'BREAST_HEALTH',
  PHARMACY: 'PHARMACY',
  DATA_OFFICER: 'DATA_OFFICER',
  LOGISTICS: 'LOGISTICS',
  VOLUNTEER: 'VOLUNTEER',
} as const

export type RoleCode = (typeof ROLES)[keyof typeof ROLES]

const P = PERMISSIONS

const CLINICAL_READ: Permission[] = [
  P.PROJECT_VIEW,
  P.PARTICIPANT_VIEW,
  P.QUEUE_MANAGE,
  P.REFERRAL_VIEW,
]

export const ROLE_DEFINITIONS: {
  code: RoleCode
  name: string
  description: string
  permissions: Permission[]
}[] = [
  {
    code: ROLES.ADMINISTRATOR,
    name: 'Administrator',
    description: 'Full access to every module, settings and security function.',
    permissions: PERMISSION_CATALOGUE.map((p) => p.code),
  },
  {
    code: ROLES.MEDICAL_DIRECTOR,
    name: 'Medical Director',
    description: 'Clinical records, referrals, reports and clinical configuration.',
    permissions: [
      ...CLINICAL_READ,
      P.TASK_VIEW,
      P.TEAM_VIEW,
      P.PARTICIPANT_CREATE,
      P.PARTICIPANT_EDIT,
      P.PARTICIPANT_OVERRIDE_DUPLICATE,
      P.VITALS_RECORD,
      P.GLUCOSE_RECORD,
      P.CLINICAL_RECORD,
      P.WOUND_RECORD,
      P.BREAST_RECORD,
      P.REFERRAL_CREATE,
      P.REFERRAL_UPDATE,
      P.FOLLOWUP_VIEW,
      P.FOLLOWUP_MANAGE,
      P.INVENTORY_VIEW,
      P.ANALYTICS_VIEW,
      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
      P.REPORTS_IDENTIFIABLE,
      P.CONFIG_CLINICAL,
      P.BACKUP_CREATE,
      P.AUDIT_VIEW,
    ],
  },
  {
    code: ROLES.DOCTOR,
    name: 'Doctor',
    description: 'Clinical assessment, documentation and referral.',
    permissions: [
      ...CLINICAL_READ,
      P.VITALS_RECORD,
      P.GLUCOSE_RECORD,
      P.CLINICAL_RECORD,
      P.WOUND_RECORD,
      P.BREAST_RECORD,
      P.REFERRAL_CREATE,
      P.REFERRAL_UPDATE,
      P.FOLLOWUP_VIEW,
      P.ANALYTICS_VIEW,
      P.REPORTS_VIEW,
    ],
  },
  {
    code: ROLES.NURSE,
    name: 'Nurse',
    description: 'Vital signs, wound care and clinical documentation.',
    permissions: [
      ...CLINICAL_READ,
      P.PARTICIPANT_CREATE,
      P.VITALS_RECORD,
      P.GLUCOSE_RECORD,
      P.WOUND_RECORD,
      P.CLINICAL_RECORD,
      P.REFERRAL_CREATE,
      P.FOLLOWUP_VIEW,
      P.INVENTORY_VIEW,
      P.REPORTS_VIEW,
    ],
  },
  {
    code: ROLES.LABORATORY,
    name: 'Laboratory user',
    description: 'Blood glucose screening.',
    permissions: [...CLINICAL_READ, P.GLUCOSE_RECORD, P.INVENTORY_VIEW, P.REPORTS_VIEW],
  },
  {
    code: ROLES.BREAST_HEALTH,
    name: 'Breast health user',
    description: 'Breast examination records and related referrals.',
    permissions: [
      ...CLINICAL_READ,
      P.BREAST_RECORD,
      P.REFERRAL_CREATE,
      P.FOLLOWUP_VIEW,
      P.REPORTS_VIEW,
    ],
  },
  {
    code: ROLES.PHARMACY,
    name: 'Pharmacy',
    description: 'Dispensing, medicines stock and the pharmacy queue.',
    permissions: [
      ...CLINICAL_READ,
      // Pharmacy holds the medicines, so it needs to move stock, not just
      // look at it. It does not record clinical findings.
      P.INVENTORY_VIEW,
      P.INVENTORY_EDIT,
      P.PROCUREMENT_VIEW,
      P.REPORTS_VIEW,
    ],
  },
  {
    code: ROLES.DATA_OFFICER,
    name: 'Data officer',
    description: 'Registration, data quality and reporting.',
    permissions: [
      ...CLINICAL_READ,
      P.PARTICIPANT_CREATE,
      P.PARTICIPANT_EDIT,
      P.TASK_VIEW,
      P.TEAM_VIEW,
      P.FOLLOWUP_VIEW,
      P.FOLLOWUP_MANAGE,
      P.ANALYTICS_VIEW,
      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
      P.BACKUP_CREATE,
    ],
  },
  {
    code: ROLES.LOGISTICS,
    name: 'Logistics user',
    description: 'Inventory, procurement, logistics and mobilisation.',
    permissions: [
      P.PROJECT_VIEW,
      P.TASK_VIEW,
      P.TASK_EDIT,
      P.TEAM_VIEW,
      P.INVENTORY_VIEW,
      P.INVENTORY_EDIT,
      P.PROCUREMENT_VIEW,
      P.PROCUREMENT_EDIT,
      P.FINANCE_VIEW,
      P.FINANCE_EDIT,
      P.MOBILISATION_EDIT,
      P.LOGISTICS_EDIT,
      P.CHECKLIST_EDIT,
      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },
  {
    code: ROLES.VOLUNTEER,
    name: 'Volunteer',
    description: 'Registration and queue movement only.',
    permissions: [P.PROJECT_VIEW, P.PARTICIPANT_VIEW, P.PARTICIPANT_CREATE, P.QUEUE_MANAGE],
  },
]

export function permissionsForRole(role: string): Set<string> {
  const def = ROLE_DEFINITIONS.find((r) => r.code === role)
  return new Set(def ? def.permissions : [])
}

export function roleName(role: string): string {
  return ROLE_DEFINITIONS.find((r) => r.code === role)?.name ?? role
}
