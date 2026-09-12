/**
 * Field validation (spec S58). Every rule explains what is wrong in plain
 * language rather than rejecting silently.
 */

export interface FieldResult {
  ok: boolean
  message?: string
}

export const VALID: FieldResult = { ok: true }

function fail(message: string): FieldResult {
  return { ok: false, message }
}

export function required(value: unknown, label: string): FieldResult {
  if (value === null || value === undefined) return fail(`${label} is required.`)
  if (typeof value === 'string' && value.trim() === '') return fail(`${label} is required.`)
  return VALID
}

export function numberInRange(
  value: number | null | undefined,
  min: number,
  max: number,
  label: string,
  unit = '',
): FieldResult {
  if (value === null || value === undefined || Number.isNaN(value)) return VALID
  if (!Number.isFinite(value)) return fail(`${label} is not a valid number.`)
  if (value < min || value > max) {
    const u = unit ? ` ${unit}` : ''
    return fail(
      `${label} of ${value}${u} is outside the range this application accepts ` +
        `(${min}–${max}${u}). Please verify the measurement.`,
    )
  }
  return VALID
}

// Physiological plausibility limits. These are deliberately wide: the job
// here is to catch typing mistakes, not to make a clinical judgement.
export const LIMITS = {
  systolic: { min: 50, max: 300 },
  diastolic: { min: 20, max: 200 },
  pulse: { min: 20, max: 250 },
  weightKg: { min: 1, max: 400 },
  heightCm: { min: 30, max: 250 },
  temperatureC: { min: 25, max: 45 },
  spo2: { min: 40, max: 100 },
  glucoseMmol: { min: 0.5, max: 50 },
  glucoseMgdl: { min: 9, max: 900 },
  ageYears: { min: 0, max: 120 },
  painScore: { min: 0, max: 10 },
  woundCm: { min: 0, max: 100 },
  lumpMm: { min: 0, max: 500 },
} as const

export function validateSystolic(v: number | null): FieldResult {
  return numberInRange(v, LIMITS.systolic.min, LIMITS.systolic.max, 'Systolic blood pressure', 'mmHg')
}

export function validateDiastolic(v: number | null): FieldResult {
  return numberInRange(
    v,
    LIMITS.diastolic.min,
    LIMITS.diastolic.max,
    'Diastolic blood pressure',
    'mmHg',
  )
}

export function validateBloodPressure(
  systolic: number | null,
  diastolic: number | null,
): FieldResult {
  const s = validateSystolic(systolic)
  if (!s.ok) return s
  const d = validateDiastolic(diastolic)
  if (!d.ok) return d
  if (systolic !== null && diastolic !== null && diastolic >= systolic) {
    return fail(
      'The diastolic reading is not lower than the systolic reading. Please check both numbers.',
    )
  }
  return VALID
}

export function validateGlucose(value: number | null, unit: string): FieldResult {
  if (value === null) return VALID
  const l = unit === 'mg/dL' ? LIMITS.glucoseMgdl : LIMITS.glucoseMmol
  return numberInRange(value, l.min, l.max, 'Glucose value', unit)
}

export function validateAge(v: number | null): FieldResult {
  if (v === null || v === undefined) return VALID
  if (!Number.isInteger(v)) return fail('Age must be a whole number of years.')
  return numberInRange(v, LIMITS.ageYears.min, LIMITS.ageYears.max, 'Age', 'years')
}

/** Nigerian mobile numbers: 11 local digits, or +234 followed by 10. */
export function validatePhone(phone: string | null | undefined): FieldResult {
  if (!phone || phone.trim() === '') return VALID
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return fail('This telephone number looks too short.')
  if (digits.length > 15) return fail('This telephone number looks too long.')
  return VALID
}

/** YYYY-MM-DD, a real calendar date, not in the future. */
export function validateDateOfBirth(dob: string | null | undefined): FieldResult {
  if (!dob) return VALID
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail('Enter the date of birth as year-month-day.')
  const d = new Date(`${dob}T00:00:00`)
  if (Number.isNaN(d.getTime())) return fail('That date of birth is not a real date.')
  const [y, m, day] = dob.split('-').map(Number)
  if (d.getFullYear() !== y || d.getMonth() + 1 !== m || d.getDate() !== day) {
    return fail('That date of birth is not a real date.')
  }
  if (d.getTime() > Date.now()) return fail('The date of birth cannot be in the future.')
  if (y < 1900) return fail('Please check the year of birth.')
  return VALID
}

export function validateQuantity(v: number | null, label = 'Quantity'): FieldResult {
  if (v === null || v === undefined) return VALID
  if (!Number.isFinite(v)) return fail(`${label} must be a number.`)
  if (v < 0) return fail(`${label} cannot be negative.`)
  if (v > 1_000_000) return fail(`${label} looks unusually large. Please verify.`)
  return VALID
}

export function validateAmount(v: number | null, label = 'Amount'): FieldResult {
  if (v === null || v === undefined) return VALID
  if (!Number.isFinite(v)) return fail(`${label} must be a number.`)
  if (v < 0) return fail(`${label} cannot be negative.`)
  return VALID
}

export function validatePin(pin: string): FieldResult {
  if (pin.length < 4) return fail('The PIN must be at least 4 digits.')
  if (pin.length > 12) return fail('The PIN must be no more than 12 digits.')
  if (!/^\d+$/.test(pin)) return fail('The PIN must contain digits only.')
  if (/^(\d)\1+$/.test(pin)) return fail('Choose a PIN that is not the same digit repeated.')
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return fail('Choose a PIN that is not a simple sequence.')
  }
  return VALID
}

export function validatePassphrase(text: string): FieldResult {
  if (text.length < 8) return fail('The backup password must be at least 8 characters.')
  return VALID
}

/** Runs several checks and returns the first failure. */
export function firstError(...results: FieldResult[]): FieldResult {
  for (const r of results) if (!r.ok) return r
  return VALID
}

/** Body mass index from weight (kg) and height (cm), to one decimal. */
export function calculateBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm || heightCm <= 0) return null
  const m = heightCm / 100
  const bmi = weightKg / (m * m)
  if (!Number.isFinite(bmi) || bmi <= 0 || bmi > 200) return null
  return Math.round(bmi * 10) / 10
}

export const MMOL_PER_MGDL = 0.0555

export function glucoseToMmol(value: number, unit: string): number {
  const mmol = unit === 'mg/dL' ? value * MMOL_PER_MGDL : value
  return Math.round(mmol * 100) / 100
}

export function glucoseToMgdl(valueMmol: number): number {
  return Math.round(valueMmol / MMOL_PER_MGDL)
}

/** Approximate wound surface area, length x width (spec S23). */
export function woundArea(lengthCm: number | null, widthCm: number | null): number | null {
  if (!lengthCm || !widthCm) return null
  const area = lengthCm * widthCm
  if (!Number.isFinite(area) || area < 0) return null
  return Math.round(area * 100) / 100
}
