/** Domain vocabularies shared by the database seed, the UI and reports. */

export const APP_NAME = 'Nichodemus Ugbor Memorial Community Health Outreach'
export const APP_SHORT_NAME = 'NUG Outreach'
export const APP_VERSION = '1.0.0'

export const PROJECT_STATUSES = [
  'PLANNING',
  'APPROVAL_PENDING',
  'APPROVED',
  'PREPARATION',
  'ACTIVE',
  'COMPLETED',
  'FOLLOW_UP',
  'CLOSED',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const TASK_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'DELAYED',
  'CANCELLED',
] as const
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export const TASK_CATEGORIES = [
  'Approval and governance',
  'Venue and logistics',
  'Team and staffing',
  'Procurement',
  'Community mobilisation',
  'Clinical preparation',
  'Data and reporting',
  'Finance',
  'Other',
]

/** Participant journey through the outreach (spec S29). */
export const WORKFLOW_STATUSES = [
  'REGISTERED',
  'WAITING',
  'VITALS',
  'GLUCOSE',
  'CLINICAL_REVIEW',
  'WOUND_CARE',
  'BREAST_CLINIC',
  'COUNSELLING',
  'REFERRAL',
  'COMPLETED',
] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  REGISTERED: 'Registered',
  WAITING: 'Waiting',
  VITALS: 'Vitals',
  GLUCOSE: 'Glucose',
  CLINICAL_REVIEW: 'Clinical review',
  WOUND_CARE: 'Wound care',
  BREAST_CLINIC: 'Breast clinic',
  COUNSELLING: 'Counselling',
  REFERRAL: 'Referral',
  COMPLETED: 'Completed',
}

/** The default forward path; staff may still send a participant anywhere. */
export const WORKFLOW_NEXT: Record<WorkflowStatus, WorkflowStatus> = {
  REGISTERED: 'WAITING',
  WAITING: 'VITALS',
  VITALS: 'GLUCOSE',
  GLUCOSE: 'CLINICAL_REVIEW',
  CLINICAL_REVIEW: 'COUNSELLING',
  WOUND_CARE: 'CLINICAL_REVIEW',
  BREAST_CLINIC: 'CLINICAL_REVIEW',
  COUNSELLING: 'COMPLETED',
  REFERRAL: 'COMPLETED',
  COMPLETED: 'COMPLETED',
}

export const DEFAULT_STATIONS: { code: string; name: string; stage: WorkflowStatus }[] = [
  { code: 'REG', name: 'Registration', stage: 'REGISTERED' },
  { code: 'VIT', name: 'Vital signs', stage: 'VITALS' },
  { code: 'GLU', name: 'Blood glucose', stage: 'GLUCOSE' },
  { code: 'CLI', name: 'Clinical consultation', stage: 'CLINICAL_REVIEW' },
  { code: 'WND', name: 'Wound care', stage: 'WOUND_CARE' },
  { code: 'BRS', name: 'Breast health', stage: 'BREAST_CLINIC' },
  { code: 'CNS', name: 'Counselling', stage: 'COUNSELLING' },
  { code: 'REF', name: 'Referral desk', stage: 'REFERRAL' },
  { code: 'EXT', name: 'Exit', stage: 'COMPLETED' },
]

export const SEXES = ['FEMALE', 'MALE'] as const
export const YES_NO_UNKNOWN = ['YES', 'NO', 'UNKNOWN'] as const

export const STAFF_ROLES = [
  'Medical Director',
  'Doctor',
  'Nurse',
  'Medical Laboratory Scientist',
  'Community Health Extension Worker',
  'Pharmacist',
  'Wound care personnel',
  'Breast health personnel',
  'Data officer',
  'Volunteer',
  'Logistics officer',
  'Security',
  'Administrator',
]

export const PROFESSIONAL_CATEGORIES = [
  'Medical',
  'Nursing',
  'Laboratory',
  'Pharmacy',
  'Community health',
  'Administration',
  'Logistics',
  'Security',
  'Volunteer',
]

export const TEAM_STATUSES = ['INVITED', 'CONFIRMED', 'DECLINED', 'WITHDRAWN'] as const
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEFT_EARLY'] as const

export const REFERRAL_STATUSES = [
  'RECOMMENDED',
  'ISSUED',
  'PATIENT_INFORMED',
  'ATTENDED',
  'NOT_ATTENDED',
  'COMPLETED',
  'CANCELLED',
  'UNKNOWN',
] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export const REFERRAL_URGENCIES = ['ROUTINE', 'PRIORITY', 'URGENT', 'EMERGENCY'] as const
export type ReferralUrgency = (typeof REFERRAL_URGENCIES)[number]

export const FOLLOWUP_OUTCOMES = [
  'PENDING',
  'CONTACTED',
  'ATTENDED_FACILITY',
  'NOT_ATTENDED',
  'UNREACHABLE',
  'DECLINED',
  'COMPLETED',
] as const

export const FACILITY_TYPES = [
  'Primary health centre',
  'General hospital',
  'Teaching hospital',
  'Specialist hospital',
  'Private clinic',
  'Laboratory',
  'Pharmacy',
  'Mission hospital',
  'Other',
]

export const INVENTORY_CATEGORIES = [
  'Medical equipment',
  'Glucose supplies',
  'Wound care supplies',
  'PPE',
  'Breast examination supplies',
  'Medicines',
  'Stationery',
  'Cleaning materials',
  'Logistics',
  'Catering',
  'Fuel',
]

export const INVENTORY_TXN_TYPES = ['OPENING', 'PURCHASE', 'USAGE', 'ADJUSTMENT', 'WASTAGE'] as const

export const PROCUREMENT_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'ORDERED',
  'RECEIVED',
  'PARTIALLY_RECEIVED',
  'CANCELLED',
] as const
export const DELIVERY_STATUSES = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL'] as const
export const PAYMENT_STATUSES = ['UNPAID', 'PART_PAID', 'PAID'] as const

export const BUDGET_CATEGORIES = [
  'Medical supplies',
  'Equipment',
  'Venue',
  'Transport',
  'Fuel',
  'Catering',
  'Security',
  'Publicity',
  'Printing',
  'Staff logistics',
  'Emergency provision',
  'Memorial materials',
  'Waste disposal',
  'Miscellaneous',
  'Contingency',
]

export const MOBILISATION_TYPES = [
  'Church announcement',
  'Town meeting',
  'Posters',
  'WhatsApp announcement',
  'Community radio',
  'Town announcer',
  'Women group meeting',
  'Youth meeting',
  'Traditional ruler engagement',
  'Other',
]

export const MOBILISATION_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const

export const LOGISTICS_CATEGORIES = [
  'Venue',
  'Furniture',
  'Power',
  'Water and sanitation',
  'Transport',
  'Security',
  'Communication',
  'Waste disposal',
]

export const LOGISTICS_STATUSES = ['REQUIRED', 'CONFIRMED', 'NOT_CONFIRMED', 'NOT_REQUIRED'] as const

export const DEFAULT_LOGISTICS: { name: string; category: string }[] = [
  { name: 'Venue', category: 'Venue' },
  { name: 'Chairs', category: 'Furniture' },
  { name: 'Tables', category: 'Furniture' },
  { name: 'Tents / canopies', category: 'Venue' },
  { name: 'Electricity supply', category: 'Power' },
  { name: 'Generator', category: 'Power' },
  { name: 'Fuel for generator', category: 'Power' },
  { name: 'Drinking water', category: 'Water and sanitation' },
  { name: 'Toilets', category: 'Water and sanitation' },
  { name: 'Transportation for team', category: 'Transport' },
  { name: 'Emergency transport / ambulance', category: 'Transport' },
  { name: 'Security personnel', category: 'Security' },
  { name: 'Public address system', category: 'Communication' },
  { name: 'Waste disposal and sharps containers', category: 'Waste disposal' },
]

export const DEFAULT_CHECKLIST: { title: string; category: string; mandatory: boolean }[] = [
  { title: 'Regulatory approval obtained', category: 'Governance', mandatory: true },
  { title: 'Venue confirmed', category: 'Logistics', mandatory: true },
  { title: 'Medical team confirmed', category: 'Team', mandatory: true },
  { title: 'Referral facilities confirmed', category: 'Clinical', mandatory: true },
  { title: 'Ambulance / emergency transport confirmed', category: 'Clinical', mandatory: true },
  { title: 'BP machines available', category: 'Clinical', mandatory: true },
  { title: 'Glucometers available', category: 'Clinical', mandatory: true },
  { title: 'Test strips available and in date', category: 'Clinical', mandatory: true },
  { title: 'Wound care supplies available', category: 'Clinical', mandatory: true },
  { title: 'PPE available', category: 'Clinical', mandatory: true },
  { title: 'Sharps containers available', category: 'Clinical', mandatory: true },
  { title: 'Waste disposal arranged', category: 'Logistics', mandatory: true },
  { title: 'Generator available', category: 'Logistics', mandatory: false },
  { title: 'Fuel available', category: 'Logistics', mandatory: false },
  { title: 'Tables and chairs available', category: 'Logistics', mandatory: false },
  { title: 'Registration system tested', category: 'Data', mandatory: true },
  { title: 'Database backup completed', category: 'Data', mandatory: true },
  { title: 'Security confirmed', category: 'Logistics', mandatory: false },
  { title: 'Community mobilisation completed', category: 'Mobilisation', mandatory: false },
]

export const AGE_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 18', min: 0, max: 17 },
  { label: '18-29', min: 18, max: 29 },
  { label: '30-39', min: 30, max: 39 },
  { label: '40-49', min: 40, max: 49 },
  { label: '50-59', min: 50, max: 59 },
  { label: '60-69', min: 60, max: 69 },
  { label: '70 and over', min: 70, max: 200 },
]

export const WOUND_TISSUE_TYPES = [
  'Granulating',
  'Epithelialising',
  'Sloughy',
  'Necrotic',
  'Mixed',
]
export const WOUND_EXUDATE_AMOUNTS = ['NONE', 'LIGHT', 'MODERATE', 'HEAVY'] as const
export const WOUND_EXUDATE_TYPES = ['Serous', 'Serosanguineous', 'Sanguineous', 'Purulent']
export const WOUND_ODOUR = ['NONE', 'MILD', 'OFFENSIVE'] as const
export const WOUND_EDGES = ['Attached', 'Rolled', 'Undermined', 'Macerated', 'Callused']
export const WOUND_SURROUNDING_SKIN = ['Intact', 'Erythematous', 'Macerated', 'Oedematous', 'Dry']
export const WOUND_INFECTION_SIGNS = [
  'NONE',
  'Local erythema and warmth',
  'Purulent discharge',
  'Increasing pain',
  'Spreading cellulitis',
  'Systemic features',
]
export const WOUND_NECROSIS = ['NONE', 'Present - localised', 'Present - extensive'] as const
export const WOUND_SWELLING = ['NONE', 'Mild', 'Moderate', 'Severe'] as const
export const WOUND_CAUSES = [
  'Trauma',
  'Diabetic foot',
  'Venous ulcer',
  'Arterial ulcer',
  'Pressure injury',
  'Burn',
  'Surgical',
  'Infection / abscess',
  'Unknown',
]
export const WOUND_SIDES = ['LEFT', 'RIGHT', 'MIDLINE', 'NOT_APPLICABLE'] as const

export const BREAST_SIDES = ['RIGHT', 'LEFT', 'BILATERAL'] as const
export const BREAST_QUADRANTS = [
  'Upper outer quadrant',
  'Upper inner quadrant',
  'Lower outer quadrant',
  'Lower inner quadrant',
  'Central / retroareolar',
  'Axillary tail',
]
export const LUMP_MOBILITY = ['Mobile', 'Partially mobile', 'Fixed', 'Not assessed']
export const LUMP_CONSISTENCY = ['Soft', 'Firm', 'Hard', 'Not assessed']
export const LUMP_TENDERNESS = ['Not tender', 'Mildly tender', 'Very tender']
export const NIPPLE_DISCHARGE = ['NONE', 'Clear', 'Milky', 'Blood stained', 'Purulent']
export const SKIN_CHANGES = ['NONE', 'Dimpling', 'Peau d orange', 'Ulceration', 'Erythema']
export const NIPPLE_CHANGES = ['NONE', 'Retraction', 'Eczema / scaling', 'Deviation']
export const AXILLARY_FINDINGS = ['NONE', 'Palpable node', 'Tender node', 'Fixed mass']

export const CONSENT_STATUSES = ['GIVEN', 'DECLINED', 'WITHDRAWN'] as const

export const SESSION_TIMEOUTS = [
  { label: '1 minute', minutes: 1 },
  { label: '5 minutes', minutes: 5 },
  { label: '10 minutes', minutes: 10 },
  { label: '30 minutes', minutes: 30 },
  { label: 'Never', minutes: 0 },
]

export const SETTING_KEYS = {
  SETUP_COMPLETE: 'setup.complete',
  ACTIVE_PROJECT: 'project.active',
  SESSION_TIMEOUT_MINUTES: 'security.session_timeout_minutes',
  LAST_BACKUP_AT: 'backup.last_at',
  BACKUP_REMINDER_HOURS: 'backup.reminder_hours',
  DEMO_MODE: 'demo.mode',
  SYNC_SERIAL_BLOCK: 'sync.serial_block',
  CLINICAL_CONFIG_UPDATED_AT: 'clinical.config_updated_at',
  CLINICAL_CONFIG_UPDATED_BY: 'clinical.config_updated_by',
  LOW_STORAGE_WARN_MB: 'storage.warn_mb',
} as const

/**
 * Participant numbers are issued from a per-device block.
 *
 * Two devices registering people at the same time with no signal between them
 * would otherwise both issue NUG-0001, and the merge would have to discard
 * one of two real participants. Device 0 issues NUG-0001..NUG-9999, device 1
 * issues NUG-10001 upwards, and so on. The familiar format is unchanged and
 * no coordination is needed at the moment of registration.
 */
export const SERIAL_BLOCK_SIZE = 10_000

export function serialRange(block: number): { min: number; max: number } {
  const min = block * SERIAL_BLOCK_SIZE + 1
  return { min, max: min + SERIAL_BLOCK_SIZE - 1 }
}

export function labelFor(code: string | null | undefined): string {
  if (!code) return '—'
  return code
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
}
