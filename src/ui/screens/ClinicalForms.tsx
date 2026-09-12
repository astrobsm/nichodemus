/**
 * Clinical data entry forms (spec S20-S24).
 *
 * Each form shows the alert the rule engine produced immediately after
 * saving, and offers to raise a referral when the alert suggests one. No
 * form ever states a diagnosis.
 */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import {
  AlertBox,
  Badge,
  Card,
  ChoiceGroup,
  KeyValue,
  Modal,
  NumberField,
  SelectField,
  TextArea,
  TextField,
  Toggle,
  friendlyError,
  useToast,
  type Tone,
} from '../components/ui'
import {
  recordVitals,
  recordGlucose,
  saveEncounter,
  createWound,
  recordWoundAssessment,
  recordBreastExamination,
  vitalsFor,
  latestVitals,
  latestGlucose,
  woundsFor,
  screeningSummaryText,
  type Wound,
} from '../../db/repo/clinical'
import { createReferral, listFacilities } from '../../db/repo/referrals'
import { moveParticipant, type Participant } from '../../db/repo/participants'
import {
  calculateBmi,
  glucoseToMmol,
  validateBloodPressure,
  validateGlucose,
  numberInRange,
  LIMITS,
  woundArea,
} from '../../core/validation'
import {
  BREAST_QUADRANTS,
  BREAST_SIDES,
  AXILLARY_FINDINGS,
  LUMP_CONSISTENCY,
  LUMP_MOBILITY,
  LUMP_TENDERNESS,
  NIPPLE_CHANGES,
  NIPPLE_DISCHARGE,
  REFERRAL_URGENCIES,
  SKIN_CHANGES,
  WOUND_CAUSES,
  WOUND_EDGES,
  WOUND_EXUDATE_AMOUNTS,
  WOUND_EXUDATE_TYPES,
  WOUND_INFECTION_SIGNS,
  WOUND_NECROSIS,
  WOUND_ODOUR,
  WOUND_SIDES,
  WOUND_SURROUNDING_SKIN,
  WOUND_SWELLING,
  WOUND_TISSUE_TYPES,
  labelFor,
} from '../../core/constants'
import { ALERT_COLOURS, type Alert } from '../../core/clinicalRules'
import { formatDateTime } from '../../core/datetime'

function toneOf(alert: Alert): Tone {
  return ALERT_COLOURS[alert.level] as Tone
}

function opt(values: readonly string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: labelFor(v) }))
}

function plain(values: readonly string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: v }))
}

/** Shown after every clinical save; offers the follow-on referral. */
function AlertResult({
  alert,
  participant,
  sourceModule,
  defaultReason,
  onDone,
}: {
  alert: Alert
  participant: Participant
  sourceModule: string
  defaultReason: string
  onDone: () => void
}) {
  const { project, can, refresh } = useApp()
  const toast = useToast()
  const [showReferral, setShowReferral] = useState(false)

  return (
    <>
      <AlertBox tone={toneOf(alert)} title={alert.title}>
        {alert.message}
      </AlertBox>

      {alert.suggestReferral && can('referral.create') ? (
        <button className="btn block" onClick={() => setShowReferral(true)}>
          Create referral
        </button>
      ) : null}
      <div style={{ height: 10 }} />
      <button className="btn block secondary" onClick={onDone}>
        Done
      </button>

      {showReferral && project ? (
        <Modal title="Create referral" onClose={() => setShowReferral(false)}>
          <ReferralForm
            participant={participant}
            sourceModule={sourceModule}
            defaultReason={defaultReason}
            defaultUrgency={alert.suggestedUrgency ?? 'ROUTINE'}
            clinicalSummary={alert.message}
            onSaved={() => {
              setShowReferral(false)
              toast('ok', 'Referral created and added to the follow-up queue.')
              refresh()
              onDone()
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

export function ReferralForm({
  participant,
  sourceModule,
  defaultReason,
  defaultUrgency,
  clinicalSummary,
  onSaved,
}: {
  participant: Participant
  sourceModule: string
  defaultReason: string
  defaultUrgency: string
  clinicalSummary?: string
  onSaved: () => void
}) {
  const { project, thresholds, refresh } = useApp()
  const toast = useToast()
  const facilities = useQuery(() => listFacilities(true), [])
  const [reason, setReason] = useState(defaultReason)
  const [urgency, setUrgency] = useState(defaultUrgency)
  const [facilityId, setFacilityId] = useState('')
  const [facilityName, setFacilityName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [transport, setTransport] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      await createReferral(
        participant.id,
        project.id,
        project.participant_prefix,
        {
          reason,
          urgency: urgency as 'ROUTINE',
          sourceModule,
          clinicalSummary,
          facilityId: facilityId ? Number(facilityId) : null,
          facilityName,
          instructions,
          transportRequired: transport,
        },
        thresholds,
      )
      refresh()
      onSaved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The referral could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TextField label="Reason for referral" value={reason} onChange={setReason} required />
      <ChoiceGroup
        label="Urgency"
        value={urgency}
        onChange={setUrgency}
        options={opt(REFERRAL_URGENCIES)}
      />
      {facilities.length ? (
        <SelectField
          label="Referral destination"
          value={facilityId}
          onChange={setFacilityId}
          placeholder="Choose a facility"
          options={facilities.map((f) => ({
            value: String(f.id),
            label: `${f.name}${f.location ? ` — ${f.location}` : ''}`,
          }))}
        />
      ) : (
        <TextField
          label="Referral destination"
          value={facilityName}
          onChange={setFacilityName}
          help="No facilities are saved yet. Add them in Settings for faster referrals."
        />
      )}
      <TextArea label="Instructions for the participant" value={instructions} onChange={setInstructions} />
      <Toggle label="Transport required" checked={transport} onChange={setTransport} />
      <button className="btn block" onClick={save} disabled={busy || !reason.trim()}>
        {busy ? 'Saving…' : 'Create referral'}
      </button>
    </>
  )
}

// =============================================================== vitals

export function VitalsForm({
  participant,
  onDone,
}: {
  participant: Participant
  onDone: () => void
}) {
  const { project, thresholds, refresh, user } = useApp()
  const toast = useToast()
  const previous = useQuery(() => vitalsFor(participant.id), [participant.id])
  const last = previous.length ? previous[previous.length - 1] : null

  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [pulse, setPulse] = useState('')
  const [weight, setWeight] = useState(last?.weight_kg ? String(last.weight_kg) : '')
  const [height, setHeight] = useState(last?.height_cm ? String(last.height_cm) : '')
  const [temperature, setTemperature] = useState('')
  const [spo2, setSpo2] = useState('')
  const [arm, setArm] = useState('LEFT')
  const [posture, setPosture] = useState('SEATED')
  const [device, setDevice] = useState(last?.device_label ?? '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Alert | null>(null)

  const sys = systolic === '' ? null : Number(systolic)
  const dia = diastolic === '' ? null : Number(diastolic)
  const bpCheck = validateBloodPressure(sys, dia)
  const pulseCheck = numberInRange(
    pulse === '' ? null : Number(pulse),
    LIMITS.pulse.min,
    LIMITS.pulse.max,
    'Pulse',
    'beats per minute',
  )
  const weightCheck = numberInRange(
    weight === '' ? null : Number(weight),
    LIMITS.weightKg.min,
    LIMITS.weightKg.max,
    'Weight',
    'kg',
  )
  const heightCheck = numberInRange(
    height === '' ? null : Number(height),
    LIMITS.heightCm.min,
    LIMITS.heightCm.max,
    'Height',
    'cm',
  )
  const tempCheck = numberInRange(
    temperature === '' ? null : Number(temperature),
    LIMITS.temperatureC.min,
    LIMITS.temperatureC.max,
    'Temperature',
    '°C',
  )
  const spo2Check = numberInRange(
    spo2 === '' ? null : Number(spo2),
    LIMITS.spo2.min,
    LIMITS.spo2.max,
    'Oxygen saturation',
    '%',
  )

  const bmi = calculateBmi(weight === '' ? null : Number(weight), height === '' ? null : Number(height))
  const canSave =
    sys !== null &&
    dia !== null &&
    bpCheck.ok &&
    pulseCheck.ok &&
    weightCheck.ok &&
    heightCheck.ok &&
    tempCheck.ok &&
    spo2Check.ok

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      const { alert } = await recordVitals(
        participant.id,
        project.id,
        {
          systolic: sys,
          diastolic: dia,
          pulse: pulse === '' ? null : Number(pulse),
          weightKg: weight === '' ? null : Number(weight),
          heightCm: height === '' ? null : Number(height),
          temperatureC: temperature === '' ? null : Number(temperature),
          spo2: spo2 === '' ? null : Number(spo2),
          arm,
          posture,
          deviceLabel: device,
          notes,
        },
        thresholds,
      )
      refresh()
      setResult(alert)
      toast('ok', `Reading ${previous.length + 1} saved for ${participant.participant_code}.`)
    } catch (err) {
      toast('danger', friendlyError(err, 'The reading could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <AlertResult
        alert={result}
        participant={participant}
        sourceModule="Vital signs"
        defaultReason="Elevated blood pressure screening measurement"
        onDone={onDone}
      />
    )
  }

  return (
    <>
      {previous.length > 0 ? (
        <Card title={`${previous.length} previous reading${previous.length === 1 ? '' : 's'}`} tight>
          {previous.map((v) => (
            <KeyValue
              key={v.id}
              k={`Reading ${v.reading_index} · ${formatDateTime(v.recorded_at)}`}
              v={
                <>
                  {v.bp_systolic}/{v.bp_diastolic} mmHg{' '}
                  {v.alert_level && v.alert_level !== 'NORMAL' ? (
                    <Badge tone={ALERT_COLOURS[v.alert_level as 'URGENT'] as Tone}>
                      {labelFor(v.alert_level)}
                    </Badge>
                  ) : null}
                </>
              }
            />
          ))}
          <p className="hint">
            This will be saved as reading {previous.length + 1}. Earlier readings are never
            overwritten.
          </p>
        </Card>
      ) : null}

      <div className="field">
        <div className="field-label">
          Blood pressure <span className="req">*</span>
        </div>
        <div className="bp-pair">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Systolic"
            aria-label="Systolic blood pressure"
            value={systolic}
            onChange={(e) => setSystolic(e.target.value)}
            autoFocus
          />
          <span className="slash" aria-hidden="true">
            /
          </span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Diastolic"
            aria-label="Diastolic blood pressure"
            value={diastolic}
            onChange={(e) => setDiastolic(e.target.value)}
          />
        </div>
        {!bpCheck.ok ? (
          <div className="field-error" role="alert">
            <span aria-hidden="true">▲</span>
            {bpCheck.message}
          </div>
        ) : null}
      </div>

      <div className="row">
        <NumberField
          label="Pulse"
          unit="bpm"
          value={pulse}
          onChange={setPulse}
          error={pulseCheck.message}
        />
        <SelectField
          label="Arm"
          value={arm}
          onChange={setArm}
          options={opt(['LEFT', 'RIGHT'])}
        />
      </div>
      <SelectField
        label="Position"
        value={posture}
        onChange={setPosture}
        options={opt(['SEATED', 'STANDING', 'LYING'])}
      />
      <div className="row">
        <NumberField
          label="Weight"
          unit="kg"
          value={weight}
          onChange={setWeight}
          error={weightCheck.message}
        />
        <NumberField
          label="Height"
          unit="cm"
          value={height}
          onChange={setHeight}
          error={heightCheck.message}
        />
      </div>
      {bmi !== null ? (
        <AlertBox tone="info" title={`BMI ${bmi}`}>
          Calculated automatically from the weight and height entered.
        </AlertBox>
      ) : null}
      <div className="row">
        <NumberField
          label="Temperature"
          unit="°C"
          value={temperature}
          onChange={setTemperature}
          error={tempCheck.message}
          help="If indicated"
        />
        <NumberField
          label="Oxygen saturation"
          unit="%"
          value={spo2}
          onChange={setSpo2}
          error={spo2Check.message}
          help="If available"
        />
      </div>
      <TextField label="Device / station label" value={device} onChange={setDevice} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />

      <div className="sticky-actions">
        <button className="btn block large" onClick={save} disabled={busy || !canSave}>
          {busy ? 'Saving…' : `Save reading ${previous.length + 1}`}
        </button>
      </div>
      <p className="fab-note">Recorded by {user?.full_name}</p>
    </>
  )
}

// ============================================================== glucose

export function GlucoseForm({
  participant,
  onDone,
}: {
  participant: Participant
  onDone: () => void
}) {
  const { project, thresholds, refresh } = useApp()
  const toast = useToast()
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('mmol/L')
  const [fasting, setFasting] = useState('NON_FASTING')
  const [device, setDevice] = useState('')
  const [lot, setLot] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Alert | null>(null)

  const num = value === '' ? null : Number(value)
  const check = validateGlucose(num, unit)
  const mmol = num !== null ? glucoseToMmol(num, unit) : null

  async function save() {
    if (!project || num === null) return
    setBusy(true)
    try {
      const { alert } = await recordGlucose(
        participant.id,
        project.id,
        {
          value: num,
          unit,
          fastingStatus: fasting as 'FASTING',
          deviceLabel: device,
          stripLot: lot,
          notes,
        },
        thresholds,
      )
      refresh()
      setResult(alert)
      toast('ok', `Glucose result saved for ${participant.participant_code}.`)
    } catch (err) {
      toast('danger', friendlyError(err, 'The result could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <AlertResult
        alert={result}
        participant={participant}
        sourceModule="Blood glucose"
        defaultReason="Abnormal blood glucose screening result"
        onDone={onDone}
      />
    )
  }

  return (
    <>
      <ChoiceGroup
        label="Fasting status"
        value={fasting}
        onChange={setFasting}
        options={opt(['FASTING', 'NON_FASTING', 'UNKNOWN'])}
        help="Fasting means no food or drink other than water for at least 8 hours."
      />
      <ChoiceGroup label="Unit" value={unit} onChange={setUnit} options={plain(['mmol/L', 'mg/dL'])} />
      <NumberField
        label="Glucose value"
        unit={unit}
        value={value}
        onChange={setValue}
        error={check.message}
        required
        autoFocus
      />
      {mmol !== null && unit === 'mg/dL' ? (
        <AlertBox tone="info" title={`${mmol} mmol/L`}>
          Converted automatically for comparison with the configured thresholds.
        </AlertBox>
      ) : null}
      <TextField label="Glucometer / device" value={device} onChange={setDevice} />
      <TextField label="Test strip lot number" value={lot} onChange={setLot} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />

      <AlertBox tone="info" title="Screening test">
        A capillary glucose result is a screening measurement. Abnormal results require
        confirmatory testing before any diagnosis is made.
      </AlertBox>

      <div className="sticky-actions">
        <button className="btn block large" onClick={save} disabled={busy || num === null || !check.ok}>
          {busy ? 'Saving…' : 'Save result'}
        </button>
      </div>
    </>
  )
}

// ========================================================= consultation

export function ConsultationForm({
  participant,
  onDone,
}: {
  participant: Participant
  onDone: () => void
}) {
  const { project, refresh } = useApp()
  const toast = useToast()
  const summary = useQuery(() => screeningSummaryText(participant.id), [participant.id])
  const vitals = useQuery(() => latestVitals(participant.id), [participant.id])
  const glucose = useQuery(() => latestGlucose(participant.id), [participant.id])

  const [concerns, setConcerns] = useState('')
  const [history, setHistory] = useState('')
  const [examination, setExamination] = useState('')
  const [assessment, setAssessment] = useState('')
  const [advice, setAdvice] = useState('')
  const [treatment, setTreatment] = useState('')
  const [counselling, setCounselling] = useState('')
  const [referral, setReferral] = useState(false)
  const [followup, setFollowup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      await saveEncounter(participant.id, project.id, {
        presentingConcerns: concerns,
        history,
        examination,
        screeningSummary: summary,
        assessment,
        advice,
        treatmentGiven: treatment,
        counsellingGiven: counselling,
        referralRequired: referral,
        followupRequired: followup,
      })
      refresh()
      toast('ok', 'Consultation documented.')
      setSaved(true)
    } catch (err) {
      toast('danger', friendlyError(err, 'The consultation could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <>
        <AlertBox tone="ok" title="Consultation saved">
          The record has been stored on this device.
        </AlertBox>
        {referral ? (
          <ReferralForm
            participant={participant}
            sourceModule="Clinical consultation"
            defaultReason={assessment || 'Clinical assessment required'}
            defaultUrgency="ROUTINE"
            clinicalSummary={summary}
            onSaved={onDone}
          />
        ) : (
          <button className="btn block" onClick={onDone}>
            Done
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <Card title="Screening findings" tight>
        <p style={{ margin: 0, fontSize: 14.5 }}>{summary}</p>
        {vitals?.alert_message ? (
          <div style={{ marginTop: 10 }}>
            <AlertBox tone={ALERT_COLOURS[vitals.alert_level as 'URGENT'] as Tone} title="Blood pressure alert">
              {vitals.alert_message}
            </AlertBox>
          </div>
        ) : null}
        {glucose?.alert_message ? (
          <AlertBox tone={ALERT_COLOURS[glucose.alert_level as 'URGENT'] as Tone} title="Glucose alert">
            {glucose.alert_message}
          </AlertBox>
        ) : null}
      </Card>

      <TextArea label="Presenting concerns" value={concerns} onChange={setConcerns} />
      <TextArea label="Relevant history" value={history} onChange={setHistory} />
      <TextArea label="Examination" value={examination} onChange={setExamination} />
      <TextArea
        label="Clinical assessment"
        value={assessment}
        onChange={setAssessment}
        help="Record what you assess clinically. Screening measurements alone are not a diagnosis."
      />
      <TextArea label="Advice given" value={advice} onChange={setAdvice} />
      <TextArea label="Treatment provided" value={treatment} onChange={setTreatment} />
      <TextArea label="Counselling given" value={counselling} onChange={setCounselling} />
      <Toggle label="Referral required" checked={referral} onChange={setReferral} />
      <Toggle label="Follow-up required" checked={followup} onChange={setFollowup} />

      <div className="sticky-actions">
        <button className="btn block large" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save consultation'}
        </button>
      </div>
    </>
  )
}

// ================================================================ wound

export function WoundForm({
  participant,
  onDone,
}: {
  participant: Participant
  onDone: () => void
}) {
  const { project, thresholds, refresh } = useApp()
  const toast = useToast()
  const existingWounds = useQuery(() => woundsFor(participant.id), [participant.id])
  const [woundId, setWoundId] = useState<string>('')
  const [location, setLocation] = useState('')
  const [side, setSide] = useState('LEFT')
  const [duration, setDuration] = useState('')
  const [cause, setCause] = useState('')

  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [depth, setDepth] = useState('')
  const [tissue, setTissue] = useState('')
  const [exudateAmount, setExudateAmount] = useState('NONE')
  const [exudateType, setExudateType] = useState('')
  const [odour, setOdour] = useState('NONE')
  const [edge, setEdge] = useState('')
  const [skin, setSkin] = useState('')
  const [infection, setInfection] = useState('NONE')
  const [pain, setPain] = useState('')
  const [swelling, setSwelling] = useState('NONE')
  const [necrosis, setNecrosis] = useState('NONE')
  const [previousTreatment, setPreviousTreatment] = useState('')
  const [cleansing, setCleansing] = useState('')
  const [dressed, setDressed] = useState(true)
  const [dressingType, setDressingType] = useState('')
  const [adviceText, setAdviceText] = useState('')
  const [nextDate, setNextDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Alert | null>(null)

  const lengthCheck = numberInRange(length === '' ? null : Number(length), 0, LIMITS.woundCm.max, 'Length', 'cm')
  const widthCheck = numberInRange(width === '' ? null : Number(width), 0, LIMITS.woundCm.max, 'Width', 'cm')
  const depthCheck = numberInRange(depth === '' ? null : Number(depth), 0, LIMITS.woundCm.max, 'Depth', 'cm')
  const painCheck = numberInRange(pain === '' ? null : Number(pain), 0, 10, 'Pain score', 'out of 10')
  const area = woundArea(length === '' ? null : Number(length), width === '' ? null : Number(width))

  const newWound = woundId === ''
  const canSave =
    (!newWound || location.trim() !== '') &&
    lengthCheck.ok && widthCheck.ok && depthCheck.ok && painCheck.ok

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      let wound: Wound
      if (newWound) {
        wound = await createWound(participant.id, project.id, project.participant_prefix, {
          location,
          side,
          durationText: duration,
          cause,
        })
      } else {
        wound = existingWounds.find((w) => String(w.id) === woundId)!
      }

      const { alert } = await recordWoundAssessment(
        wound,
        {
          lengthCm: length === '' ? null : Number(length),
          widthCm: width === '' ? null : Number(width),
          depthCm: depth === '' ? null : Number(depth),
          tissueType: tissue,
          exudateAmount,
          exudateType,
          odour,
          woundEdge: edge,
          surroundingSkin: skin,
          infectionSigns: infection,
          painScore: pain === '' ? null : Number(pain),
          swelling,
          necrosis,
          previousTreatment,
          cleansingDone: cleansing,
          dressingApplied: dressed,
          dressingType,
          advice: adviceText,
          nextDressingDate: nextDate,
          notes,
        },
        thresholds,
      )
      refresh()
      setResult(alert)
      toast('ok', `Wound assessment saved (${wound.wound_code}).`)
    } catch (err) {
      toast('danger', friendlyError(err, 'The wound assessment could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <AlertResult
        alert={result}
        participant={participant}
        sourceModule="Wound care"
        defaultReason="Wound requiring further clinical management"
        onDone={onDone}
      />
    )
  }

  return (
    <>
      {existingWounds.length > 0 ? (
        <SelectField
          label="Wound"
          value={woundId}
          onChange={setWoundId}
          placeholder="New wound"
          options={existingWounds.map((w) => ({
            value: String(w.id),
            label: `${w.wound_code} — ${w.location ?? 'Unspecified'}${w.side ? ` (${labelFor(w.side)})` : ''}`,
          }))}
        />
      ) : null}

      {newWound ? (
        <Card title="Wound identification">
          <TextField label="Location on the body" value={location} onChange={setLocation} required />
          <ChoiceGroup label="Side" value={side} onChange={setSide} options={opt(WOUND_SIDES)} />
          <TextField
            label="Duration"
            value={duration}
            onChange={setDuration}
            help="For example: 3 weeks"
          />
          <SelectField label="Cause" value={cause} onChange={setCause} placeholder="Not stated" options={plain(WOUND_CAUSES)} />
        </Card>
      ) : null}

      <Card title="Measurements">
        <div className="row">
          <NumberField label="Length" unit="cm" value={length} onChange={setLength} error={lengthCheck.message} />
          <NumberField label="Width" unit="cm" value={width} onChange={setWidth} error={widthCheck.message} />
        </div>
        <NumberField label="Depth" unit="cm" value={depth} onChange={setDepth} error={depthCheck.message} help="Where appropriate" />
        {area !== null ? (
          <AlertBox tone="info" title={`Approximate surface area ${area} cm²`}>
            Calculated as length × width. This is an approximate value, not a precise measurement.
          </AlertBox>
        ) : null}
      </Card>

      <Card title="Wound characteristics">
        <SelectField label="Tissue type" value={tissue} onChange={setTissue} placeholder="Not recorded" options={plain(WOUND_TISSUE_TYPES)} />
        <ChoiceGroup label="Exudate amount" value={exudateAmount} onChange={setExudateAmount} options={opt(WOUND_EXUDATE_AMOUNTS)} />
        <SelectField label="Exudate type" value={exudateType} onChange={setExudateType} placeholder="Not recorded" options={plain(WOUND_EXUDATE_TYPES)} />
        <ChoiceGroup label="Odour" value={odour} onChange={setOdour} options={opt(WOUND_ODOUR)} />
        <SelectField label="Wound edge" value={edge} onChange={setEdge} placeholder="Not recorded" options={plain(WOUND_EDGES)} />
        <SelectField label="Surrounding skin" value={skin} onChange={setSkin} placeholder="Not recorded" options={plain(WOUND_SURROUNDING_SKIN)} />
        <SelectField label="Signs of infection" value={infection} onChange={setInfection} options={plain(WOUND_INFECTION_SIGNS)} />
        <NumberField label="Pain score" unit="0 to 10" value={pain} onChange={setPain} error={painCheck.message} />
        <ChoiceGroup label="Swelling" value={swelling} onChange={setSwelling} options={opt(WOUND_SWELLING)} />
        <SelectField label="Necrosis" value={necrosis} onChange={setNecrosis} options={plain(WOUND_NECROSIS)} />
        <TextArea label="Previous treatment" value={previousTreatment} onChange={setPreviousTreatment} />
      </Card>

      <Card title="Care given">
        <TextField label="Cleansing performed" value={cleansing} onChange={setCleansing} help="For example: irrigated with normal saline" />
        <Toggle label="Dressing applied" checked={dressed} onChange={setDressed} />
        {dressed ? <TextField label="Dressing type" value={dressingType} onChange={setDressingType} /> : null}
        <TextArea label="Advice given" value={adviceText} onChange={setAdviceText} />
        <TextField label="Next dressing date" type="date" value={nextDate} onChange={setNextDate} />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
      </Card>

      <div className="sticky-actions">
        <button className="btn block large" onClick={save} disabled={busy || !canSave}>
          {busy ? 'Saving…' : 'Save wound assessment'}
        </button>
      </div>
    </>
  )
}

// =============================================================== breast

export function BreastForm({
  participant,
  onDone,
}: {
  participant: Participant
  onDone: () => void
}) {
  const { project, thresholds, refresh } = useApp()
  const toast = useToast()
  const [examined, setExamined] = useState('BILATERAL')
  const [chaperone, setChaperone] = useState(true)
  const [normal, setNormal] = useState(true)
  const [lump, setLump] = useState(false)
  const [lumpSide, setLumpSide] = useState('RIGHT')
  const [lumpLocation, setLumpLocation] = useState('')
  const [lumpSize, setLumpSize] = useState('')
  const [mobility, setMobility] = useState('')
  const [consistency, setConsistency] = useState('')
  const [tenderness, setTenderness] = useState('')
  const [discharge, setDischarge] = useState('NONE')
  const [skinChange, setSkinChange] = useState('NONE')
  const [nippleChange, setNippleChange] = useState('NONE')
  const [axillary, setAxillary] = useState('NONE')
  const [pain, setPain] = useState('')
  const [other, setOther] = useState('')
  const [bse, setBse] = useState(true)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Alert | null>(null)

  const sizeCheck = numberInRange(
    lumpSize === '' ? null : Number(lumpSize),
    0,
    LIMITS.lumpMm.max,
    'Lump size',
    'mm',
  )

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      const { alert } = await recordBreastExamination(
        participant.id,
        project.id,
        {
          breastExamined: examined,
          chaperonePresent: chaperone,
          noAbnormality: normal,
          lumpPresent: lump,
          lumpSide: lump ? lumpSide : undefined,
          lumpLocation: lump ? lumpLocation : undefined,
          lumpSizeMm: lump && lumpSize !== '' ? Number(lumpSize) : null,
          lumpMobility: lump ? mobility : undefined,
          lumpConsistency: lump ? consistency : undefined,
          lumpTenderness: lump ? tenderness : undefined,
          nippleDischarge: discharge,
          skinChange,
          nippleChange,
          axillaryFinding: axillary,
          pain,
          otherFinding: other,
          bseTaught: bse,
          notes,
        },
        thresholds,
      )
      refresh()
      setResult(alert)
      toast('ok', 'Breast examination recorded.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The examination could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <AlertResult
        alert={result}
        participant={participant}
        sourceModule="Breast health"
        defaultReason="Abnormal clinical breast examination finding"
        onDone={onDone}
      />
    )
  }

  return (
    <>
      <AlertBox tone="info" title="Privacy">
        Carry out this examination in a private space. Record a chaperone where one is present.
      </AlertBox>

      <ChoiceGroup label="Breast examined" value={examined} onChange={setExamined} options={opt(BREAST_SIDES)} />
      <Toggle label="Chaperone present" checked={chaperone} onChange={setChaperone} />
      <Toggle
        label="No abnormality detected"
        help="Turn this off to record findings."
        checked={normal}
        onChange={(v) => {
          setNormal(v)
          if (v) {
            setLump(false)
            setDischarge('NONE')
            setSkinChange('NONE')
            setNippleChange('NONE')
            setAxillary('NONE')
            setOther('')
          }
        }}
      />

      {!normal ? (
        <>
          <Card title="Findings">
            <Toggle label="Lump present" checked={lump} onChange={setLump} />
            {lump ? (
              <>
                <ChoiceGroup label="Side" value={lumpSide} onChange={setLumpSide} options={opt(['RIGHT', 'LEFT', 'BILATERAL'])} />
                <SelectField label="Location" value={lumpLocation} onChange={setLumpLocation} placeholder="Not recorded" options={plain(BREAST_QUADRANTS)} />
                <NumberField label="Approximate size" unit="mm" value={lumpSize} onChange={setLumpSize} error={sizeCheck.message} />
                <SelectField label="Mobility" value={mobility} onChange={setMobility} placeholder="Not assessed" options={plain(LUMP_MOBILITY)} />
                <SelectField label="Consistency" value={consistency} onChange={setConsistency} placeholder="Not assessed" options={plain(LUMP_CONSISTENCY)} />
                <SelectField label="Tenderness" value={tenderness} onChange={setTenderness} placeholder="Not assessed" options={plain(LUMP_TENDERNESS)} />
              </>
            ) : null}
            <SelectField label="Nipple discharge" value={discharge} onChange={setDischarge} options={plain(NIPPLE_DISCHARGE)} />
            <SelectField label="Skin change" value={skinChange} onChange={setSkinChange} options={plain(SKIN_CHANGES)} />
            <SelectField label="Nipple change" value={nippleChange} onChange={setNippleChange} options={plain(NIPPLE_CHANGES)} />
            <SelectField label="Axillary finding" value={axillary} onChange={setAxillary} options={plain(AXILLARY_FINDINGS)} />
            <TextField label="Pain" value={pain} onChange={setPain} help="Describe if reported" />
            <TextArea label="Other finding" value={other} onChange={setOther} />
          </Card>
          <AlertBox tone="warn" title="Documenting findings, not diagnoses">
            Record what you observe. This system does not classify any breast finding as cancer.
          </AlertBox>
        </>
      ) : null}

      <Toggle label="Breast self-examination taught" checked={bse} onChange={setBse} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />

      <div className="sticky-actions">
        <button className="btn block large" onClick={save} disabled={busy || !sizeCheck.ok}>
          {busy ? 'Saving…' : 'Save examination'}
        </button>
      </div>
    </>
  )
}

/** Sends the participant onward after a station finishes with them. */
export function SendOnward({
  participant,
  onMoved,
}: {
  participant: Participant
  onMoved: () => void
}) {
  const { refresh } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function move(to: string) {
    setBusy(true)
    try {
      await moveParticipant(participant.id, to as 'WAITING')
      refresh()
      toast('ok', `${participant.participant_code} sent to ${labelFor(to)}.`)
      onMoved()
    } catch (err) {
      toast('danger', friendlyError(err, 'The participant could not be moved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="btn-row">
      {['VITALS', 'GLUCOSE', 'CLINICAL_REVIEW', 'WOUND_CARE', 'BREAST_CLINIC', 'COUNSELLING', 'COMPLETED'].map((s) => (
        <button key={s} className="btn secondary small" disabled={busy} onClick={() => move(s)}>
          {labelFor(s)}
        </button>
      ))}
    </div>
  )
}
