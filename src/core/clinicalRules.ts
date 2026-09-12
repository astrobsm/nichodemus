/**
 * Configurable clinical alert engine (spec S25).
 *
 * IMPORTANT CLINICAL SAFETY PRINCIPLE (spec S4)
 * ---------------------------------------------
 * Nothing in this file produces a diagnosis. It produces *screening*
 * classifications and referral prompts. Every threshold is read from the
 * clinical_configurations table so that the clinical administrator, not
 * this source file, owns the clinical governance decision.
 */

export type AlertLevel = 'NORMAL' | 'INFO' | 'ATTENTION' | 'URGENT'

export interface Alert {
  level: AlertLevel
  title: string
  message: string
  suggestReferral: boolean
  suggestedUrgency?: 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'EMERGENCY'
}

export const NORMAL_ALERT: Alert = {
  level: 'NORMAL',
  title: 'Within expected screening range',
  message: 'No screening alert triggered by the configured thresholds.',
  suggestReferral: false,
}

/** Default thresholds seeded on first run. All are editable in Settings. */
export interface ClinicalThresholds {
  bpSystolicElevated: number
  bpDiastolicElevated: number
  bpSystolicHigh: number
  bpDiastolicHigh: number
  bpSystolicUrgent: number
  bpDiastolicUrgent: number
  bpSystolicLow: number
  glucoseLowMmol: number
  glucoseRandomElevatedMmol: number
  glucoseRandomHighMmol: number
  glucoseFastingElevatedMmol: number
  glucoseFastingHighMmol: number
  glucoseUrgentMmol: number
  woundPainAlert: number
  woundAreaAlertCm2: number
  breastLumpAlertMm: number
  followupIntervalDays: number
  urgentFollowupIntervalDays: number
}

export const DEFAULT_THRESHOLDS: ClinicalThresholds = {
  // Blood pressure, mmHg
  bpSystolicElevated: 140,
  bpDiastolicElevated: 90,
  bpSystolicHigh: 160,
  bpDiastolicHigh: 100,
  bpSystolicUrgent: 180,
  bpDiastolicUrgent: 110,
  bpSystolicLow: 90,
  // Capillary glucose, mmol/L
  glucoseLowMmol: 3.9,
  glucoseRandomElevatedMmol: 7.8,
  glucoseRandomHighMmol: 11.1,
  glucoseFastingElevatedMmol: 6.1,
  glucoseFastingHighMmol: 7.0,
  glucoseUrgentMmol: 20.0,
  // Wound
  woundPainAlert: 7,
  woundAreaAlertCm2: 25,
  // Breast
  breastLumpAlertMm: 0, // any recorded lump triggers the referral prompt
  // Follow-up intervals, days
  followupIntervalDays: 14,
  urgentFollowupIntervalDays: 3,
}

export const THRESHOLD_METADATA: {
  key: keyof ClinicalThresholds
  label: string
  group: string
  unit: string
  description: string
}[] = [
  {
    key: 'bpSystolicElevated',
    label: 'Systolic - elevated screening result',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this systolic value the reading is flagged for repeat and review.',
  },
  {
    key: 'bpDiastolicElevated',
    label: 'Diastolic - elevated screening result',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this diastolic value the reading is flagged for repeat and review.',
  },
  {
    key: 'bpSystolicHigh',
    label: 'Systolic - markedly elevated',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this value a clinical review is prompted.',
  },
  {
    key: 'bpDiastolicHigh',
    label: 'Diastolic - markedly elevated',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this value a clinical review is prompted.',
  },
  {
    key: 'bpSystolicUrgent',
    label: 'Systolic - urgent review',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this value an urgent clinical review prompt is raised.',
  },
  {
    key: 'bpDiastolicUrgent',
    label: 'Diastolic - urgent review',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'At or above this value an urgent clinical review prompt is raised.',
  },
  {
    key: 'bpSystolicLow',
    label: 'Systolic - low reading prompt',
    group: 'Blood pressure',
    unit: 'mmHg',
    description: 'Below this systolic value the reading is flagged for clinical attention.',
  },
  {
    key: 'glucoseLowMmol',
    label: 'Low glucose prompt',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'Below this value a low-glucose alert is raised.',
  },
  {
    key: 'glucoseRandomElevatedMmol',
    label: 'Random glucose - elevated',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'At or above this random/non-fasting value the result is flagged as abnormal.',
  },
  {
    key: 'glucoseRandomHighMmol',
    label: 'Random glucose - markedly elevated',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'At or above this random value a clinical review prompt is raised.',
  },
  {
    key: 'glucoseFastingElevatedMmol',
    label: 'Fasting glucose - elevated',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'At or above this fasting value the result is flagged as abnormal.',
  },
  {
    key: 'glucoseFastingHighMmol',
    label: 'Fasting glucose - markedly elevated',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'At or above this fasting value a clinical review prompt is raised.',
  },
  {
    key: 'glucoseUrgentMmol',
    label: 'Glucose - urgent review',
    group: 'Blood glucose',
    unit: 'mmol/L',
    description: 'At or above this value an urgent clinical review prompt is raised.',
  },
  {
    key: 'woundPainAlert',
    label: 'Wound pain score alert',
    group: 'Wound care',
    unit: '0-10',
    description: 'At or above this pain score a clinical review prompt is raised.',
  },
  {
    key: 'woundAreaAlertCm2',
    label: 'Wound area alert',
    group: 'Wound care',
    unit: 'cm²',
    description: 'At or above this approximate surface area a clinical review prompt is raised.',
  },
  {
    key: 'breastLumpAlertMm',
    label: 'Breast lump referral prompt',
    group: 'Breast health',
    unit: 'mm',
    description:
      'A recorded lump at or above this size raises a referral prompt. Zero means any lump.',
  },
  {
    key: 'followupIntervalDays',
    label: 'Routine follow-up interval',
    group: 'Follow-up',
    unit: 'days',
    description: 'Default number of days until a routine follow-up falls due.',
  },
  {
    key: 'urgentFollowupIntervalDays',
    label: 'Urgent follow-up interval',
    group: 'Follow-up',
    unit: 'days',
    description: 'Default number of days until an urgent follow-up falls due.',
  },
]

// ------------------------------------------------------------------- BP

export function evaluateBloodPressure(
  systolic: number | null,
  diastolic: number | null,
  t: ClinicalThresholds,
): Alert {
  if (systolic === null || diastolic === null) return NORMAL_ALERT

  if (systolic >= t.bpSystolicUrgent || diastolic >= t.bpDiastolicUrgent) {
    return {
      level: 'URGENT',
      title: 'Urgent clinical review required',
      message:
        `A blood pressure screening measurement of ${systolic}/${diastolic} mmHg is at or above ` +
        `the configured urgent threshold. Repeat the measurement after rest and arrange immediate ` +
        `clinical assessment. This is a screening measurement, not a diagnosis.`,
      suggestReferral: true,
      suggestedUrgency: 'URGENT',
    }
  }
  if (systolic >= t.bpSystolicHigh || diastolic >= t.bpDiastolicHigh) {
    return {
      level: 'ATTENTION',
      title: 'Attention required',
      message:
        `Blood pressure screening result is markedly elevated at ${systolic}/${diastolic} mmHg. ` +
        `Repeat measurement and clinical assessment are recommended.`,
      suggestReferral: true,
      suggestedUrgency: 'PRIORITY',
    }
  }
  if (systolic >= t.bpSystolicElevated || diastolic >= t.bpDiastolicElevated) {
    return {
      level: 'ATTENTION',
      title: 'Attention required',
      message:
        `Blood pressure screening result is elevated at ${systolic}/${diastolic} mmHg. ` +
        `Repeat measurement and clinical assessment are recommended.`,
      suggestReferral: false,
    }
  }
  if (systolic < t.bpSystolicLow) {
    return {
      level: 'ATTENTION',
      title: 'Low reading - please check',
      message:
        `A systolic screening measurement of ${systolic} mmHg is below the configured low ` +
        `threshold. Confirm the reading and assess the participant clinically.`,
      suggestReferral: false,
    }
  }
  return NORMAL_ALERT
}

// -------------------------------------------------------------- glucose

export type FastingStatus = 'FASTING' | 'NON_FASTING' | 'UNKNOWN'

export function evaluateGlucose(
  valueMmol: number | null,
  fasting: FastingStatus,
  t: ClinicalThresholds,
): Alert {
  if (valueMmol === null) return NORMAL_ALERT

  if (valueMmol < t.glucoseLowMmol) {
    return {
      level: 'URGENT',
      title: 'Low glucose screening result',
      message:
        `A capillary glucose of ${valueMmol} mmol/L is below the configured low threshold. ` +
        `Treat symptomatic hypoglycaemia immediately according to local protocol and arrange ` +
        `clinical assessment.`,
      suggestReferral: true,
      suggestedUrgency: 'URGENT',
    }
  }
  if (valueMmol >= t.glucoseUrgentMmol) {
    return {
      level: 'URGENT',
      title: 'Abnormal screening result - urgent review',
      message:
        `A capillary glucose of ${valueMmol} mmol/L is at or above the configured urgent ` +
        `threshold. Urgent clinical assessment is recommended. Screening results require ` +
        `confirmatory testing before any diagnosis is made.`,
      suggestReferral: true,
      suggestedUrgency: 'URGENT',
    }
  }

  const isFasting = fasting === 'FASTING'
  const highCut = isFasting ? t.glucoseFastingHighMmol : t.glucoseRandomHighMmol
  const elevatedCut = isFasting ? t.glucoseFastingElevatedMmol : t.glucoseRandomElevatedMmol
  const label = isFasting ? 'fasting' : 'non-fasting'

  if (valueMmol >= highCut) {
    return {
      level: 'ATTENTION',
      title: 'Abnormal screening result',
      message:
        `A ${label} capillary glucose of ${valueMmol} mmol/L is at or above the configured ` +
        `threshold for a markedly elevated screening result. Further clinical assessment and ` +
        `confirmatory testing are recommended. This is a screening result, not a diagnosis.`,
      suggestReferral: true,
      suggestedUrgency: 'PRIORITY',
    }
  }
  if (valueMmol >= elevatedCut) {
    return {
      level: 'ATTENTION',
      title: 'Abnormal screening result',
      message:
        `A ${label} capillary glucose of ${valueMmol} mmol/L is above the configured expected ` +
        `range. Further clinical assessment is recommended. Abnormal screening results require ` +
        `confirmatory testing.`,
      suggestReferral: false,
    }
  }
  if (fasting === 'UNKNOWN') {
    return {
      level: 'INFO',
      title: 'Within expected screening range',
      message:
        'Fasting status was not recorded, so this result has been assessed against the ' +
        'non-fasting thresholds.',
      suggestReferral: false,
    }
  }
  return NORMAL_ALERT
}

// ---------------------------------------------------------------- wound

export interface WoundSignals {
  areaCm2: number | null
  painScore: number | null
  infectionSigns: string | null
  necrosis: string | null
  odour: string | null
  exudateAmount: string | null
}

export function evaluateWound(s: WoundSignals, t: ClinicalThresholds): Alert {
  const reasons: string[] = []
  let level: AlertLevel = 'NORMAL'

  const hasInfection = Boolean(s.infectionSigns && s.infectionSigns !== 'NONE')
  const hasNecrosis = Boolean(s.necrosis && s.necrosis !== 'NONE')
  const hasOdour = Boolean(s.odour && s.odour !== 'NONE')

  if (hasInfection) {
    reasons.push('signs suggestive of wound infection were recorded')
    level = 'URGENT'
  }
  if (hasNecrosis) {
    reasons.push('necrotic tissue was recorded')
    level = 'URGENT'
  }
  if (hasOdour) {
    reasons.push('wound odour was recorded')
    if (level === 'NORMAL') level = 'ATTENTION'
  }
  if (s.painScore !== null && s.painScore >= t.woundPainAlert) {
    reasons.push(`a pain score of ${s.painScore} out of 10 was recorded`)
    if (level === 'NORMAL') level = 'ATTENTION'
  }
  if (s.areaCm2 !== null && s.areaCm2 >= t.woundAreaAlertCm2) {
    reasons.push(`an approximate wound surface area of ${s.areaCm2} cm² was recorded`)
    if (level === 'NORMAL') level = 'ATTENTION'
  }
  if (s.exudateAmount === 'HEAVY') {
    reasons.push('heavy exudate was recorded')
    if (level === 'NORMAL') level = 'ATTENTION'
  }

  if (level === 'NORMAL') return NORMAL_ALERT

  return {
    level,
    title: 'Clinical review required',
    message:
      `This wound assessment triggered a review prompt because ${reasons.join(', ')}. ` +
      `A clinician should review the wound and decide whether referral is required.`,
    suggestReferral: level === 'URGENT',
    suggestedUrgency: level === 'URGENT' ? 'PRIORITY' : 'ROUTINE',
  }
}

// --------------------------------------------------------------- breast

export interface BreastSignals {
  noAbnormality: boolean
  lumpPresent: boolean
  lumpSizeMm: number | null
  nippleDischarge: string | null
  skinChange: string | null
  nippleChange: string | null
  axillaryFinding: string | null
  otherFinding: string | null
}

function present(v: string | null): boolean {
  return Boolean(v && v !== 'NONE' && v.trim() !== '')
}

export function evaluateBreast(s: BreastSignals, t: ClinicalThresholds): Alert {
  if (s.noAbnormality) return NORMAL_ALERT

  const findings: string[] = []
  if (s.lumpPresent) {
    const size = s.lumpSizeMm !== null ? ` (approximately ${s.lumpSizeMm} mm)` : ''
    findings.push(`a breast lump${size}`)
  }
  if (present(s.nippleDischarge)) findings.push('nipple discharge')
  if (present(s.skinChange)) findings.push('a skin change')
  if (present(s.nippleChange)) findings.push('a nipple change')
  if (present(s.axillaryFinding)) findings.push('an axillary finding')
  if (present(s.otherFinding)) findings.push('another abnormal finding')

  if (findings.length === 0) return NORMAL_ALERT

  const lumpMeetsThreshold =
    s.lumpPresent && (t.breastLumpAlertMm <= 0 || (s.lumpSizeMm ?? 0) >= t.breastLumpAlertMm)

  return {
    level: 'ATTENTION',
    title: 'Referral consideration',
    message:
      `Abnormal finding identified: ${findings.join(', ')}. Clinical review and appropriate ` +
      `further breast evaluation or referral are recommended. This record documents a clinical ` +
      `finding only; it is not a diagnosis.`,
    suggestReferral: lumpMeetsThreshold || findings.length > 0,
    suggestedUrgency: 'PRIORITY',
  }
}

// ------------------------------------------------------------ follow-up

export function followupIntervalFor(
  urgency: string,
  t: ClinicalThresholds,
): number {
  return urgency === 'URGENT' || urgency === 'EMERGENCY'
    ? t.urgentFollowupIntervalDays
    : t.followupIntervalDays
}

export const ALERT_COLOURS: Record<AlertLevel, string> = {
  NORMAL: 'ok',
  INFO: 'info',
  ATTENTION: 'warn',
  URGENT: 'danger',
}

export const ALERT_LABELS: Record<AlertLevel, string> = {
  NORMAL: 'Within expected range',
  INFO: 'Information',
  ATTENTION: 'Attention required',
  URGENT: 'Urgent',
}
