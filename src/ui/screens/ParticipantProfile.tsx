/** Participant profile with the tabbed clinical record (spec S19). */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import { navigate, goBack } from '../router'
import {
  AlertBox,
  Badge,
  Card,
  EmptyState,
  KeyValue,
  Modal,
  Tabs,
  friendlyError,
  useToast,
  type Tone,
} from '../components/ui'
import {
  consentsFor,
  fullName,
  getParticipant,
  participantHistory,
  participantProgress,
} from '../../db/repo/participants'
import {
  breastExamsFor,
  encountersFor,
  glucoseFor,
  vitalsFor,
  woundAssessmentsFor,
  woundsFor,
} from '../../db/repo/clinical'
import { followupsFor, referralsFor, updateReferralStatus } from '../../db/repo/referrals'
import { auditForEntity } from '../../core/audit'
import { formatDateTime, formatShortDate } from '../../core/datetime'
import { ALERT_COLOURS } from '../../core/clinicalRules'
import { labelFor, WORKFLOW_LABELS, REFERRAL_STATUSES } from '../../core/constants'
import { PERMISSIONS } from '../../core/permissions'
import {
  BreastForm,
  ConsultationForm,
  GlucoseForm,
  ReferralForm,
  SendOnward,
  VitalsForm,
  WoundForm,
} from './ClinicalForms'
import { ConsentPanel } from './Participants'

type Tab = 'PROFILE' | 'SCREENING' | 'CLINICAL' | 'WOUND' | 'BREAST' | 'REFERRAL' | 'FOLLOWUP' | 'HISTORY'

type FormKind = 'VITALS' | 'GLUCOSE' | 'CONSULT' | 'WOUND' | 'BREAST' | 'REFERRAL' | 'CONSENT' | null

export function ParticipantProfile({ id }: { id: number }) {
  const { can, refresh } = useApp()
  const participant = useQuery(() => getParticipant(id), [id])
  const progress = useQuery(() => (participant ? participantProgress(id) : null), [id])
  const [tab, setTab] = useState<Tab>('PROFILE')
  const [form, setForm] = useState<FormKind>(null)

  if (!participant) {
    return (
      <EmptyState glyph="□" title="Participant not found">
        This record may have been removed.{' '}
        <button className="btn small secondary" onClick={() => navigate('/people')}>
          Back to participants
        </button>
      </EmptyState>
    )
  }

  const closeForm = () => {
    setForm(null)
    refresh()
  }

  return (
    <>
      <button className="btn ghost small" onClick={() => goBack('/people')}>
        ‹ Back
      </button>

      <Card tight>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="code-chip">{participant.participant_code}</span>
          <Badge tone={participant.workflow_status === 'COMPLETED' ? 'ok' : 'info'}>
            {WORKFLOW_LABELS[participant.workflow_status]}
          </Badge>
          {participant.is_demo ? <Badge tone="muted">Demo</Badge> : null}
        </div>
        <h2 style={{ margin: '0 0 2px', fontSize: 20 }}>{fullName(participant)}</h2>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          {labelFor(participant.sex)}
          {participant.age_years !== null
            ? `, ${participant.age_years} years${participant.age_is_estimated ? ' (approximate)' : ''}`
            : ', age not recorded'}
          {participant.community ? ` · ${participant.community}` : ''}
        </div>
        {progress && !progress.consentGiven ? (
          <div style={{ marginTop: 10 }}>
            <AlertBox tone="warn" title="No consent recorded">
              Record consent before clinical assessment.
            </AlertBox>
          </div>
        ) : null}
      </Card>

      <Card title="Record actions" tight>
        <div className="btn-row">
          {can(PERMISSIONS.VITALS_RECORD) ? (
            <button className="btn" onClick={() => setForm('VITALS')}>
              Vital signs
            </button>
          ) : null}
          {can(PERMISSIONS.GLUCOSE_RECORD) ? (
            <button className="btn" onClick={() => setForm('GLUCOSE')}>
              Glucose
            </button>
          ) : null}
          {can(PERMISSIONS.CLINICAL_RECORD) ? (
            <button className="btn secondary" onClick={() => setForm('CONSULT')}>
              Consultation
            </button>
          ) : null}
          {can(PERMISSIONS.WOUND_RECORD) ? (
            <button className="btn secondary" onClick={() => setForm('WOUND')}>
              Wound care
            </button>
          ) : null}
          {can(PERMISSIONS.BREAST_RECORD) && participant.sex === 'FEMALE' ? (
            <button className="btn secondary" onClick={() => setForm('BREAST')}>
              Breast health
            </button>
          ) : null}
          {can(PERMISSIONS.REFERRAL_CREATE) ? (
            <button className="btn secondary" onClick={() => setForm('REFERRAL')}>
              Referral
            </button>
          ) : null}
        </div>
        {can(PERMISSIONS.QUEUE_MANAGE) ? (
          <>
            <div className="card-title" style={{ marginTop: 14 }}>Send to</div>
            <SendOnward participant={participant} onMoved={refresh} />
          </>
        ) : null}
      </Card>

      <Tabs
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: 'PROFILE', label: 'Profile' },
          { key: 'SCREENING', label: 'Screening', badge: (progress?.vitals ?? 0) + (progress?.glucose ?? 0) },
          { key: 'CLINICAL', label: 'Clinical', badge: progress?.clinical },
          { key: 'WOUND', label: 'Wound', badge: progress?.wounds },
          { key: 'BREAST', label: 'Breast', badge: progress?.breast },
          { key: 'REFERRAL', label: 'Referral', badge: progress?.referrals },
          { key: 'FOLLOWUP', label: 'Follow-up', badge: progress?.followupsPending },
          { key: 'HISTORY', label: 'History' },
        ]}
      />

      {tab === 'PROFILE' ? <ProfileTab id={id} onRecordConsent={() => setForm('CONSENT')} /> : null}
      {tab === 'SCREENING' ? <ScreeningTab id={id} /> : null}
      {tab === 'CLINICAL' ? <ClinicalTab id={id} /> : null}
      {tab === 'WOUND' ? <WoundTab id={id} /> : null}
      {tab === 'BREAST' ? <BreastTab id={id} /> : null}
      {tab === 'REFERRAL' ? <ReferralTab id={id} /> : null}
      {tab === 'FOLLOWUP' ? <FollowupTab id={id} /> : null}
      {tab === 'HISTORY' ? <HistoryTab id={id} /> : null}

      {form ? (
        <Modal
          title={
            {
              VITALS: 'Vital signs',
              GLUCOSE: 'Blood glucose screening',
              CONSULT: 'Clinical consultation',
              WOUND: 'Wound assessment',
              BREAST: 'Breast examination',
              REFERRAL: 'Create referral',
              CONSENT: 'Record consent',
            }[form]
          }
          subtitle={`${participant.participant_code} · ${fullName(participant)}`}
          onClose={closeForm}
          wide
        >
          {form === 'VITALS' ? <VitalsForm participant={participant} onDone={closeForm} /> : null}
          {form === 'GLUCOSE' ? <GlucoseForm participant={participant} onDone={closeForm} /> : null}
          {form === 'CONSULT' ? <ConsultationForm participant={participant} onDone={closeForm} /> : null}
          {form === 'WOUND' ? <WoundForm participant={participant} onDone={closeForm} /> : null}
          {form === 'BREAST' ? <BreastForm participant={participant} onDone={closeForm} /> : null}
          {form === 'REFERRAL' ? (
            <ReferralForm
              participant={participant}
              sourceModule="Participant profile"
              defaultReason=""
              defaultUrgency="ROUTINE"
              onSaved={closeForm}
            />
          ) : null}
          {form === 'CONSENT' ? <ConsentPanel participantId={id} onRecorded={closeForm} /> : null}
        </Modal>
      ) : null}
    </>
  )
}

function ProfileTab({ id, onRecordConsent }: { id: number; onRecordConsent: () => void }) {
  const { can } = useApp()
  const p = useQuery(() => getParticipant(id), [id])
  const consents = useQuery(() => consentsFor(id), [id])
  if (!p) return null

  return (
    <>
      <Card title="Identification">
        <KeyValue k="Participant ID" v={p.participant_code} />
        <KeyValue k="Full name" v={fullName(p)} />
        {p.preferred_name ? <KeyValue k="Preferred name" v={p.preferred_name} /> : null}
        <KeyValue k="Sex" v={labelFor(p.sex)} />
        <KeyValue
          k="Age"
          v={
            p.age_years !== null
              ? `${p.age_years} years${p.age_is_estimated ? ' (approximate)' : ''}`
              : 'Not recorded'
          }
        />
        {p.date_of_birth ? <KeyValue k="Date of birth" v={formatShortDate(p.date_of_birth)} /> : null}
        <KeyValue k="Registered" v={formatDateTime(p.registered_at)} />
      </Card>

      <Card title="Contact">
        <KeyValue k="Community" v={p.community ?? 'Not recorded'} />
        <KeyValue k="Occupation" v={p.occupation ?? 'Not recorded'} />
        <KeyValue k="Telephone" v={p.phone ?? 'Not recorded'} />
        <KeyValue k="Contact person" v={p.contact_person ?? 'Not recorded'} />
        <KeyValue k="Contact telephone" v={p.contact_phone ?? 'Not recorded'} />
      </Card>

      <Card title="Clinical background">
        <KeyValue k="Known high blood pressure" v={labelFor(p.known_hypertension)} />
        <KeyValue k="Known diabetes" v={labelFor(p.known_diabetes)} />
        {p.sex === 'FEMALE' ? (
          <KeyValue k="Previous breast problem" v={labelFor(p.previous_breast_problem)} />
        ) : null}
        <KeyValue k="Current medications" v={p.current_medications ?? 'None recorded'} />
        <KeyValue k="Relevant history" v={p.medical_history ?? 'None recorded'} />
      </Card>

      <Card title="Consent" action={<button className="btn small secondary" onClick={onRecordConsent}>Record</button>}>
        {consents.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>No consent has been recorded for this participant.</p>
        ) : (
          consents.map((c) => (
            <KeyValue
              key={c.id}
              k={`${labelFor(c.consent_type)} · ${formatDateTime(c.obtained_at)}`}
              v={
                <>
                  <Badge tone={c.status === 'GIVEN' ? 'ok' : 'warn'}>{labelFor(c.status)}</Badge>{' '}
                  {c.obtained_by}
                </>
              }
            />
          ))
        )}
      </Card>

      {p.duplicate_override_by ? (
        <AlertBox tone="warn" title="Registered despite a duplicate warning">
          Overridden by {p.duplicate_override_by}. Reason: {p.duplicate_override_reason}
        </AlertBox>
      ) : null}

      {can(PERMISSIONS.PARTICIPANT_EDIT) ? (
        <button className="btn secondary block" onClick={() => navigate(`/register?edit=${id}`)}>
          Edit participant details
        </button>
      ) : null}
    </>
  )
}

function ScreeningTab({ id }: { id: number }) {
  const vitals = useQuery(() => vitalsFor(id), [id])
  const glucose = useQuery(() => glucoseFor(id), [id])

  return (
    <>
      <Card title="Blood pressure and vital signs">
        {vitals.length === 0 ? (
          <EmptyState glyph="□" title="No vital signs recorded" />
        ) : (
          vitals.map((v) => (
            <div key={v.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 18 }}>
                  {v.bp_systolic}/{v.bp_diastolic} <span style={{ fontSize: 13, fontWeight: 400 }}>mmHg</span>
                </strong>
                <Badge tone={(ALERT_COLOURS[(v.alert_level ?? 'NORMAL') as 'NORMAL'] ?? 'muted') as Tone}>
                  {labelFor(v.alert_level ?? 'NORMAL')}
                </Badge>
              </div>
              <div className="hint">
                Reading {v.reading_index} · {formatDateTime(v.recorded_at)} · {v.recorded_by}
                {v.pulse ? ` · pulse ${v.pulse}` : ''}
                {v.bmi ? ` · BMI ${v.bmi}` : ''}
                {v.temperature_c ? ` · ${v.temperature_c}°C` : ''}
                {v.spo2 ? ` · SpO₂ ${v.spo2}%` : ''}
              </div>
              {v.alert_message ? <div className="hint" style={{ marginTop: 4 }}>{v.alert_message}</div> : null}
            </div>
          ))
        )}
        {vitals.length > 1 ? (
          <p className="hint">
            Every reading is preserved. The first measurement is never replaced by a repeat.
          </p>
        ) : null}
      </Card>

      <Card title="Blood glucose">
        {glucose.length === 0 ? (
          <EmptyState glyph="□" title="No glucose result recorded" />
        ) : (
          glucose.map((g) => (
            <div key={g.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 18 }}>
                  {g.value} <span style={{ fontSize: 13, fontWeight: 400 }}>{g.unit}</span>
                </strong>
                <Badge tone={(ALERT_COLOURS[(g.alert_level ?? 'NORMAL') as 'NORMAL'] ?? 'muted') as Tone}>
                  {labelFor(g.alert_level ?? 'NORMAL')}
                </Badge>
              </div>
              <div className="hint">
                {labelFor(g.fasting_status)} · {formatDateTime(g.tested_at)} · {g.operator}
                {g.unit !== 'mmol/L' ? ` · ${g.value_mmol} mmol/L` : ''}
              </div>
              {g.alert_message ? <div className="hint" style={{ marginTop: 4 }}>{g.alert_message}</div> : null}
            </div>
          ))
        )}
      </Card>
    </>
  )
}

function ClinicalTab({ id }: { id: number }) {
  const encounters = useQuery(() => encountersFor(id), [id])
  if (encounters.length === 0) {
    return <EmptyState glyph="□" title="No clinical consultation recorded" />
  }
  return (
    <>
      {encounters.map((e) => (
        <Card key={e.id} title={`${formatDateTime(e.encounter_at)} · ${e.clinician ?? ''}`}>
          {e.presenting_concerns ? <KeyValue k="Presenting concerns" v={e.presenting_concerns} /> : null}
          {e.history ? <KeyValue k="History" v={e.history} /> : null}
          {e.examination ? <KeyValue k="Examination" v={e.examination} /> : null}
          {e.screening_summary ? <KeyValue k="Screening findings" v={e.screening_summary} /> : null}
          {e.assessment ? <KeyValue k="Assessment" v={e.assessment} /> : null}
          {e.advice ? <KeyValue k="Advice" v={e.advice} /> : null}
          {e.treatment_given ? <KeyValue k="Treatment" v={e.treatment_given} /> : null}
          {e.counselling_given ? <KeyValue k="Counselling" v={e.counselling_given} /> : null}
          <KeyValue k="Referral required" v={e.referral_required ? 'Yes' : 'No'} />
          <KeyValue k="Follow-up required" v={e.followup_required ? 'Yes' : 'No'} />
        </Card>
      ))}
    </>
  )
}

function WoundTab({ id }: { id: number }) {
  const wounds = useQuery(() => woundsFor(id), [id])
  const assessments = useQuery(() => woundAssessmentsFor(id), [id])
  if (wounds.length === 0) return <EmptyState glyph="□" title="No wound recorded" />

  return (
    <>
      {wounds.map((w) => (
        <Card key={w.id} title={`${w.wound_code} · ${w.location ?? 'Location not recorded'}`}>
          <KeyValue k="Side" v={labelFor(w.side ?? '')} />
          <KeyValue k="Cause" v={w.cause ?? 'Not recorded'} />
          <KeyValue k="Duration" v={w.duration_text ?? 'Not recorded'} />
          <KeyValue k="Status" v={labelFor(w.status)} />
          {assessments
            .filter((a) => a.wound_id === w.id)
            .map((a) => (
              <div key={a.id} style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 14.5 }}>{formatDateTime(a.assessed_at)}</strong>
                  <Badge tone={(ALERT_COLOURS[(a.alert_level ?? 'NORMAL') as 'NORMAL'] ?? 'muted') as Tone}>
                    {labelFor(a.alert_level ?? 'NORMAL')}
                  </Badge>
                </div>
                <div className="hint">
                  {a.length_cm ?? '?'} × {a.width_cm ?? '?'} cm
                  {a.area_cm2 !== null ? ` · approximately ${a.area_cm2} cm²` : ''}
                  {a.depth_cm ? ` · depth ${a.depth_cm} cm` : ''}
                  {a.tissue_type ? ` · ${a.tissue_type}` : ''}
                  {a.pain_score !== null ? ` · pain ${a.pain_score}/10` : ''}
                </div>
                {a.dressing_applied ? (
                  <div className="hint">Dressing applied: {a.dressing_type ?? 'type not recorded'}</div>
                ) : null}
                {a.next_dressing_date ? (
                  <div className="hint">Next dressing: {formatShortDate(a.next_dressing_date)}</div>
                ) : null}
                {a.alert_message ? <div className="hint" style={{ marginTop: 4 }}>{a.alert_message}</div> : null}
              </div>
            ))}
        </Card>
      ))}
    </>
  )
}

function BreastTab({ id }: { id: number }) {
  const exams = useQuery(() => breastExamsFor(id), [id])
  if (exams.length === 0) return <EmptyState glyph="□" title="No breast examination recorded" />
  return (
    <>
      {exams.map((b) => (
        <Card key={b.id} title={`${formatDateTime(b.examined_at)} · ${b.examiner ?? ''}`}>
          <div style={{ marginBottom: 8 }}>
            <Badge tone={b.no_abnormality ? 'ok' : 'warn'}>
              {b.no_abnormality ? 'No abnormality detected' : 'Abnormal finding recorded'}
            </Badge>
          </div>
          <KeyValue k="Breast examined" v={labelFor(b.breast_examined)} />
          <KeyValue k="Chaperone present" v={b.chaperone_present ? 'Yes' : 'No'} />
          {b.lump_present ? (
            <>
              <KeyValue k="Lump" v={`${labelFor(b.lump_side ?? '')} ${b.lump_location ?? ''}`.trim()} />
              {b.lump_size_mm ? <KeyValue k="Approximate size" v={`${b.lump_size_mm} mm`} /> : null}
              {b.lump_mobility ? <KeyValue k="Mobility" v={b.lump_mobility} /> : null}
              {b.lump_consistency ? <KeyValue k="Consistency" v={b.lump_consistency} /> : null}
              {b.lump_tenderness ? <KeyValue k="Tenderness" v={b.lump_tenderness} /> : null}
            </>
          ) : null}
          {b.nipple_discharge && b.nipple_discharge !== 'NONE' ? <KeyValue k="Nipple discharge" v={b.nipple_discharge} /> : null}
          {b.skin_change && b.skin_change !== 'NONE' ? <KeyValue k="Skin change" v={b.skin_change} /> : null}
          {b.nipple_change && b.nipple_change !== 'NONE' ? <KeyValue k="Nipple change" v={b.nipple_change} /> : null}
          {b.axillary_finding && b.axillary_finding !== 'NONE' ? <KeyValue k="Axillary finding" v={b.axillary_finding} /> : null}
          {b.other_finding ? <KeyValue k="Other finding" v={b.other_finding} /> : null}
          <KeyValue k="Self-examination taught" v={b.bse_taught ? 'Yes' : 'No'} />
          {b.alert_message ? (
            <div style={{ marginTop: 10 }}>
              <AlertBox tone="warn" title="Referral consideration">
                {b.alert_message}
              </AlertBox>
            </div>
          ) : null}
        </Card>
      ))}
    </>
  )
}

function ReferralTab({ id }: { id: number }) {
  const { can, refresh } = useApp()
  const toast = useToast()
  const referrals = useQuery(() => referralsFor(id), [id])
  const [editing, setEditing] = useState<number | null>(null)
  const [status, setStatus] = useState('')

  if (referrals.length === 0) return <EmptyState glyph="□" title="No referral issued" />

  async function apply(referralId: number) {
    try {
      await updateReferralStatus(referralId, status as 'ISSUED')
      toast('ok', 'Referral status updated.')
      refresh()
      setEditing(null)
    } catch (err) {
      toast('danger', friendlyError(err, 'The status could not be updated.'))
    }
  }

  return (
    <>
      {referrals.map((r) => (
        <Card key={r.id} title={`${r.referral_code} · ${formatShortDate(r.referral_date)}`}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <Badge tone={r.urgency === 'ROUTINE' ? 'info' : r.urgency === 'PRIORITY' ? 'warn' : 'danger'}>
              {labelFor(r.urgency)}
            </Badge>
            <Badge tone={r.status === 'COMPLETED' || r.status === 'ATTENDED' ? 'ok' : 'muted'}>
              {labelFor(r.status)}
            </Badge>
          </div>
          <KeyValue k="Reason" v={r.reason} />
          <KeyValue k="Destination" v={r.facility_name ?? 'Not specified'} />
          <KeyValue k="Referred by" v={r.referring_clinician ?? ''} />
          {r.instructions ? <KeyValue k="Instructions" v={r.instructions} /> : null}
          {r.transport_required ? <KeyValue k="Transport" v="Required" /> : null}

          {can(PERMISSIONS.REFERRAL_UPDATE) ? (
            editing === r.id ? (
              <div style={{ marginTop: 10 }}>
                <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Referral status">
                  <option value="">Choose a status</option>
                  {REFERRAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {labelFor(s)}
                    </option>
                  ))}
                </select>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn secondary small" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button className="btn small" disabled={!status} onClick={() => void apply(r.id)}>
                    Save status
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn secondary small"
                style={{ marginTop: 10 }}
                onClick={() => {
                  setEditing(r.id)
                  setStatus(r.status)
                }}
              >
                Update status
              </button>
            )
          ) : null}
        </Card>
      ))}
    </>
  )
}

function FollowupTab({ id }: { id: number }) {
  const followups = useQuery(() => followupsFor(id), [id])
  if (followups.length === 0) return <EmptyState glyph="□" title="No follow-up scheduled" />
  return (
    <>
      {followups.map((f) => (
        <Card key={f.id} title={`Due ${formatShortDate(f.due_date)}`}>
          <div style={{ marginBottom: 8 }}>
            <Badge tone={f.outcome === 'COMPLETED' ? 'ok' : f.outcome === 'PENDING' ? 'warn' : 'info'}>
              {labelFor(f.outcome)}
            </Badge>
          </div>
          <KeyValue k="Reason" v={f.reason ?? ''} />
          <KeyValue k="Contact attempts" v={f.contact_attempts} />
          {f.last_contact_at ? <KeyValue k="Last contact" v={formatDateTime(f.last_contact_at)} /> : null}
          {f.facility_attended ? <KeyValue k="Facility attended" v={f.facility_attended} /> : null}
          {f.further_treatment ? <KeyValue k="Further treatment" v={f.further_treatment} /> : null}
          {f.notes ? <KeyValue k="Notes" v={f.notes} /> : null}
          <button className="btn secondary block small" style={{ marginTop: 10 }} onClick={() => navigate('/clinical/followup')}>
            Open follow-up queue
          </button>
        </Card>
      ))}
    </>
  )
}

function HistoryTab({ id }: { id: number }) {
  const { can } = useApp()
  const movements = useQuery(() => participantHistory(id), [id])
  const audit = useQuery(
    () => (can(PERMISSIONS.AUDIT_VIEW) ? auditForEntity('participant', id) : []),
    [id],
  )

  return (
    <>
      <Card title="Journey through the outreach">
        {movements.length === 0 ? (
          <EmptyState glyph="□" title="No movements recorded" />
        ) : (
          movements.map((m) => (
            <KeyValue
              key={m.id}
              k={formatDateTime(m.occurred_at)}
              v={
                <>
                  {m.from_status ? `${labelFor(m.from_status)} → ` : ''}
                  {labelFor(m.to_status)}
                  {m.actor ? <span className="hint"> · {m.actor}</span> : null}
                </>
              }
            />
          ))
        )}
      </Card>

      {can(PERMISSIONS.AUDIT_VIEW) ? (
        <Card title="Record changes">
          {audit.length === 0 ? (
            <EmptyState glyph="□" title="No changes recorded" />
          ) : (
            audit.map((a) => (
              <div key={a.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.summary}</div>
                <div className="hint">
                  {formatDateTime(a.occurred_at)} · {a.username} ({labelFor(a.user_role)})
                </div>
                {a.previous_value && a.new_value ? (
                  <div className="hint" style={{ marginTop: 3 }}>
                    Was {a.previous_value} — now {a.new_value}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </Card>
      ) : null}
    </>
  )
}
