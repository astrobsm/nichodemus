/** Participant search, filters and registration (spec S15-S18, S53, S54, S65). */
import { useMemo, useState } from 'react'
import { useApp, useQuery } from '../AppState'
import { navigate } from '../router'
import {
  AlertBox,
  Badge,
  Card,
  ChoiceGroup,
  EmptyState,
  Modal,
  NumberField,
  SelectField,
  TextArea,
  TextField,
  Toggle,
  friendlyError,
  useToast,
} from '../components/ui'
import {
  DuplicateParticipantError,
  countParticipants,
  fullName,
  listCommunities,
  registerParticipant,
  searchParticipants,
  updateParticipant,
  type DuplicateMatch,
  type Participant,
  type ParticipantInput,
} from '../../db/repo/participants'
import { getParticipant } from '../../db/repo/participants'
import {
  CONSENT_STATUSES,
  OCCUPATION_HINT,
  SEXES,
  WORKFLOW_LABELS,
  WORKFLOW_STATUSES,
  YES_NO_UNKNOWN,
  labelFor,
  type WorkflowStatus,
} from './participantConstants'
import { PERMISSIONS } from '../../core/permissions'
import {
  validateAge,
  validateDateOfBirth,
  validatePhone,
  firstError,
  required,
} from '../../core/validation'
import { ageFromDob, formatShortDate } from '../../core/datetime'

const WORKFLOW_TONE: Record<string, 'ok' | 'warn' | 'info' | 'muted'> = {
  COMPLETED: 'ok',
  REGISTERED: 'info',
  WAITING: 'warn',
}

export function ParticipantsScreen() {
  const { project, can } = useApp()
  const [search, setSearch] = useState('')
  const [sex, setSex] = useState('')
  const [status, setStatus] = useState('')
  const [community, setCommunity] = useState('')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(0)

  const pageSize = 50
  const filter = useMemo(
    () => ({
      search,
      sex,
      status: status as WorkflowStatus | '',
      community,
      minAge: minAge === '' ? null : Number(minAge),
      maxAge: maxAge === '' ? null : Number(maxAge),
      limit: pageSize,
      offset: page * pageSize,
    }),
    [search, sex, status, community, minAge, maxAge, page],
  )

  const rows = useQuery(
    () => (project ? searchParticipants(project.id, filter) : []),
    [project?.id, filter],
  )
  const total = useQuery(
    () => (project ? countParticipants(project.id, { ...filter, limit: undefined, offset: undefined }) : 0),
    [project?.id, filter],
  )
  const communities = useQuery(() => (project ? listCommunities(project.id) : []), [project?.id])

  if (!project) return <EmptyState glyph="□" title="No active project" />

  const activeFilters = [sex, status, community, minAge, maxAge].filter(Boolean).length

  return (
    <>
      <div className="field" style={{ marginBottom: 10 }}>
        <input
          type="search"
          inputMode="search"
          placeholder="Search by ID, name or telephone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          aria-label="Search participants"
        />
      </div>

      <div className="btn-row" style={{ marginBottom: 12 }}>
        {can(PERMISSIONS.PARTICIPANT_CREATE) ? (
          <button className="btn" onClick={() => navigate('/register')}>
            Register participant
          </button>
        ) : null}
        <button className="btn secondary" onClick={() => setShowFilters(true)}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        {total} participant{total === 1 ? '' : 's'} match
        {activeFilters || search ? ' the current search' : ' in this project'}.
      </p>

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState glyph="□" title="No participants found">
            {search || activeFilters
              ? 'Try a different search or clear the filters.'
              : 'Register the first participant to begin.'}
          </EmptyState>
        ) : (
          rows.map((p) => <ParticipantRow key={p.id} p={p} />)
        )}
      </Card>

      {total > pageSize ? (
        <div className="btn-row">
          <button className="btn secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            className="btn secondary"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}

      {showFilters ? (
        <Modal title="Filters" onClose={() => setShowFilters(false)}>
          <ChoiceGroup
            label="Sex"
            value={sex}
            onChange={setSex}
            options={[{ value: '', label: 'Any' }, ...SEXES.map((s) => ({ value: s, label: labelFor(s) }))]}
          />
          <SelectField
            label="Stage"
            value={status}
            onChange={setStatus}
            placeholder="Any stage"
            options={WORKFLOW_STATUSES.map((s) => ({ value: s, label: WORKFLOW_LABELS[s] }))}
          />
          <SelectField
            label="Community"
            value={community}
            onChange={setCommunity}
            placeholder="Any community"
            options={communities.map((c) => ({ value: c, label: c }))}
          />
          <div className="row">
            <NumberField label="Minimum age" value={minAge} onChange={setMinAge} />
            <NumberField label="Maximum age" value={maxAge} onChange={setMaxAge} />
          </div>
          <div className="btn-row">
            <button
              className="btn secondary"
              onClick={() => {
                setSex('')
                setStatus('')
                setCommunity('')
                setMinAge('')
                setMaxAge('')
                setPage(0)
              }}
            >
              Clear all
            </button>
            <button className="btn" onClick={() => setShowFilters(false)}>
              Apply
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function ParticipantRow({ p }: { p: Participant }) {
  return (
    <button className="list-item" onClick={() => navigate(`/participant/${p.id}`)}>
      <span className="code-chip">{p.participant_code}</span>
      <span className="grow">
        <span className="primary">{fullName(p)}</span>
        <span className="secondary">
          {labelFor(p.sex)}
          {p.age_years !== null ? `, ${p.age_years}${p.age_is_estimated ? ' (est.)' : ''} yrs` : ''}
          {p.community ? ` · ${p.community}` : ''}
        </span>
      </span>
      <Badge tone={WORKFLOW_TONE[p.workflow_status] ?? 'muted'}>
        {WORKFLOW_LABELS[p.workflow_status]}
      </Badge>
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  )
}

// ======================================================== registration

type Section = 'IDENTITY' | 'DEMOGRAPHICS' | 'CONTACT' | 'HISTORY' | 'CONSENT'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'IDENTITY', label: 'Identity' },
  { key: 'DEMOGRAPHICS', label: 'Demographics' },
  { key: 'CONTACT', label: 'Contact' },
  { key: 'HISTORY', label: 'Medical history' },
  { key: 'CONSENT', label: 'Consent' },
]

export function RegisterScreen({ editId }: { editId?: number }) {
  const { project, can, refresh, user } = useApp()
  const toast = useToast()
  const existing = useQuery(() => (editId ? getParticipant(editId) : null), [editId])

  const [open, setOpen] = useState<Section>('IDENTITY')
  const [form, setForm] = useState<ParticipantInput>(() =>
    existing
      ? {
          firstName: existing.first_name,
          middleName: existing.middle_name ?? '',
          lastName: existing.last_name,
          preferredName: existing.preferred_name ?? '',
          sex: existing.sex,
          dateOfBirth: existing.date_of_birth ?? '',
          ageYears: existing.age_years,
          ageIsEstimated: Boolean(existing.age_is_estimated),
          community: existing.community ?? '',
          phone: existing.phone ?? '',
          occupation: existing.occupation ?? '',
          contactPerson: existing.contact_person ?? '',
          contactPhone: existing.contact_phone ?? '',
          knownHypertension: existing.known_hypertension,
          knownDiabetes: existing.known_diabetes,
          previousBreastProblem: existing.previous_breast_problem,
          currentMedications: existing.current_medications ?? '',
          medicalHistory: existing.medical_history ?? '',
        }
      : {
          firstName: '',
          middleName: '',
          lastName: '',
          preferredName: '',
          sex: '',
          dateOfBirth: '',
          ageYears: null,
          ageIsEstimated: false,
          community: project?.location ?? '',
          phone: '',
          occupation: '',
          contactPerson: '',
          contactPhone: '',
          knownHypertension: 'UNKNOWN',
          knownDiabetes: 'UNKNOWN',
          previousBreastProblem: 'UNKNOWN',
          currentMedications: '',
          medicalHistory: '',
          consentStatus: 'GIVEN',
          consentObtainedBy: user?.full_name ?? '',
          consentNotes: '',
        },
  )
  const [ageText, setAgeText] = useState(existing?.age_years ? String(existing.age_years) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [overrideReason, setOverrideReason] = useState('')

  function set<K extends keyof ParticipantInput>(key: K, value: ParticipantInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const derivedAge = form.dateOfBirth ? ageFromDob(form.dateOfBirth) : null

  const errors = {
    firstName: required(form.firstName, 'First name').message,
    lastName: required(form.lastName, 'Last name').message,
    sex: required(form.sex, 'Sex').message,
    dob: validateDateOfBirth(form.dateOfBirth).message,
    age: validateAge(ageText === '' ? null : Number(ageText)).message,
    phone: validatePhone(form.phone).message,
    contactPhone: validatePhone(form.contactPhone).message,
  }
  const blocking = firstError(
    required(form.firstName, 'First name'),
    required(form.lastName, 'Last name'),
    required(form.sex, 'Sex'),
    validateDateOfBirth(form.dateOfBirth),
    validateAge(ageText === '' ? null : Number(ageText)),
    validatePhone(form.phone),
    validatePhone(form.contactPhone),
  )

  async function save(overrideDuplicate = false) {
    if (!project) return
    setBusy(true)
    setError(null)
    try {
      const payload: ParticipantInput = {
        ...form,
        ageYears: ageText === '' ? null : Number(ageText),
      }
      if (existing) {
        await updateParticipant(existing.id, payload)
        toast('ok', `${existing.participant_code} updated.`)
        refresh()
        navigate(`/participant/${existing.id}`)
        return
      }
      const created = await registerParticipant(project, payload, {
        overrideDuplicate,
        overrideReason,
      })
      toast('ok', `${created.participant_code} registered.`)
      refresh()
      navigate(`/participant/${created.id}`)
    } catch (err) {
      if (err instanceof DuplicateParticipantError) {
        setDuplicates(err.matches)
      } else {
        setError(friendlyError(err, 'The participant could not be saved.'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (!project) return <EmptyState glyph="□" title="No active project" />

  return (
    <>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>
        {existing ? `Edit ${existing.participant_code}` : 'Register participant'}
      </h2>
      {!existing ? (
        <p className="hint" style={{ marginTop: 0 }}>
          The participant number is generated automatically when you save.
        </p>
      ) : null}

      {error ? (
        <AlertBox tone="danger" title="Could not save">
          {error}
        </AlertBox>
      ) : null}

      {SECTIONS.map((s) => (
        <Card key={s.key} tight>
          <button
            onClick={() => setOpen(open === s.key ? ('' as Section) : s.key)}
            style={{
              background: 'none',
              border: 0,
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              minHeight: 44,
              cursor: 'pointer',
              fontSize: 15.5,
              fontWeight: 700,
            }}
            aria-expanded={open === s.key}
          >
            {s.label}
            <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
              {open === s.key ? '−' : '+'}
            </span>
          </button>

          {open === s.key ? (
            <div style={{ paddingTop: 8 }}>
              {s.key === 'IDENTITY' ? (
                <>
                  <TextField
                    label="First name"
                    value={form.firstName}
                    onChange={(v) => set('firstName', v)}
                    required
                    error={errors.firstName}
                    autoFocus
                  />
                  <TextField
                    label="Middle name"
                    value={form.middleName ?? ''}
                    onChange={(v) => set('middleName', v)}
                  />
                  <TextField
                    label="Last name"
                    value={form.lastName}
                    onChange={(v) => set('lastName', v)}
                    required
                    error={errors.lastName}
                  />
                  <TextField
                    label="Preferred name"
                    value={form.preferredName ?? ''}
                    onChange={(v) => set('preferredName', v)}
                    help="What the participant would like to be called."
                  />
                </>
              ) : null}

              {s.key === 'DEMOGRAPHICS' ? (
                <>
                  <ChoiceGroup
                    label="Sex"
                    value={form.sex}
                    onChange={(v) => set('sex', v)}
                    required
                    error={errors.sex}
                    options={SEXES.map((x) => ({ value: x, label: labelFor(x) }))}
                  />
                  <TextField
                    label="Date of birth"
                    type="date"
                    value={form.dateOfBirth ?? ''}
                    onChange={(v) => {
                      set('dateOfBirth', v)
                      const a = v ? ageFromDob(v) : null
                      if (a !== null) setAgeText(String(a))
                    }}
                    error={errors.dob}
                    help={
                      derivedAge !== null
                        ? `Age calculated automatically: ${derivedAge} years.`
                        : 'Leave blank if the exact date of birth is unknown.'
                    }
                  />
                  <NumberField
                    label={derivedAge !== null ? 'Age (calculated)' : 'Approximate age'}
                    unit="years"
                    value={ageText}
                    onChange={setAgeText}
                    error={errors.age}
                    help={
                      derivedAge !== null
                        ? 'Calculated from the date of birth above.'
                        : 'Use this when the date of birth is not known.'
                    }
                  />
                  <TextField
                    label="Community"
                    value={form.community ?? ''}
                    onChange={(v) => set('community', v)}
                  />
                  <TextField
                    label="Occupation"
                    value={form.occupation ?? ''}
                    onChange={(v) => set('occupation', v)}
                    help={OCCUPATION_HINT}
                  />
                </>
              ) : null}

              {s.key === 'CONTACT' ? (
                <>
                  <TextField
                    label="Telephone number"
                    type="tel"
                    inputMode="tel"
                    value={form.phone ?? ''}
                    onChange={(v) => set('phone', v)}
                    error={errors.phone}
                    help="Needed for follow-up after the outreach."
                  />
                  <TextField
                    label="Contact person"
                    value={form.contactPerson ?? ''}
                    onChange={(v) => set('contactPerson', v)}
                  />
                  <TextField
                    label="Contact person telephone"
                    type="tel"
                    inputMode="tel"
                    value={form.contactPhone ?? ''}
                    onChange={(v) => set('contactPhone', v)}
                    error={errors.contactPhone}
                  />
                </>
              ) : null}

              {s.key === 'HISTORY' ? (
                <>
                  <ChoiceGroup
                    label="Known high blood pressure"
                    value={form.knownHypertension ?? 'UNKNOWN'}
                    onChange={(v) => set('knownHypertension', v)}
                    options={YES_NO_UNKNOWN.map((x) => ({ value: x, label: labelFor(x) }))}
                  />
                  <ChoiceGroup
                    label="Known diabetes"
                    value={form.knownDiabetes ?? 'UNKNOWN'}
                    onChange={(v) => set('knownDiabetes', v)}
                    options={YES_NO_UNKNOWN.map((x) => ({ value: x, label: labelFor(x) }))}
                  />
                  {form.sex === 'FEMALE' ? (
                    <ChoiceGroup
                      label="Previous breast problem"
                      value={form.previousBreastProblem ?? 'UNKNOWN'}
                      onChange={(v) => set('previousBreastProblem', v)}
                      options={YES_NO_UNKNOWN.map((x) => ({ value: x, label: labelFor(x) }))}
                    />
                  ) : null}
                  <TextArea
                    label="Current medications"
                    value={form.currentMedications ?? ''}
                    onChange={(v) => set('currentMedications', v)}
                  />
                  <TextArea
                    label="Relevant medical history"
                    value={form.medicalHistory ?? ''}
                    onChange={(v) => set('medicalHistory', v)}
                  />
                </>
              ) : null}

              {s.key === 'CONSENT' ? (
                existing ? (
                  <p className="hint">
                    Consent is recorded from the participant profile so that each consent event
                    keeps its own date and the name of the person who obtained it.
                  </p>
                ) : (
                  <>
                    <AlertBox tone="info" title="Consent">
                      Explain what will be recorded and why, and that the participant may decline
                      any part of the assessment. Only the information needed for care and
                      follow-up is collected.
                    </AlertBox>
                    <ChoiceGroup
                      label="Consent status"
                      value={form.consentStatus ?? 'GIVEN'}
                      onChange={(v) => set('consentStatus', v)}
                      options={CONSENT_STATUSES.map((x) => ({ value: x, label: labelFor(x) }))}
                    />
                    <TextField
                      label="Consent obtained by"
                      value={form.consentObtainedBy ?? ''}
                      onChange={(v) => set('consentObtainedBy', v)}
                    />
                    <TextArea
                      label="Consent notes"
                      value={form.consentNotes ?? ''}
                      onChange={(v) => set('consentNotes', v)}
                    />
                  </>
                )
              ) : null}
            </div>
          ) : null}
        </Card>
      ))}

      {!blocking.ok ? (
        <AlertBox tone="warn" title="Before saving">
          {blocking.message}
        </AlertBox>
      ) : null}

      <div className="sticky-actions">
        <button
          className="btn block large"
          onClick={() => void save(false)}
          disabled={busy || !blocking.ok}
        >
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save participant'}
        </button>
      </div>

      {duplicates ? (
        <Modal
          title="Possible duplicate"
          subtitle="A participant with similar information already exists."
          onClose={() => setDuplicates(null)}
        >
          {duplicates.map((d) => (
            <button
              key={d.participant.id}
              className="list-item"
              style={{ border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8 }}
              onClick={() => navigate(`/participant/${d.participant.id}`)}
            >
              <span className="code-chip">{d.participant.participant_code}</span>
              <span className="grow">
                <span className="primary">{fullName(d.participant)}</span>
                <span className="secondary">
                  Matches on {d.reasons.join(', ')}
                  {d.participant.registered_at
                    ? ` · registered ${formatShortDate(d.participant.registered_at)}`
                    : ''}
                </span>
              </span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          ))}

          {can(PERMISSIONS.PARTICIPANT_OVERRIDE_DUPLICATE) ? (
            <>
              <TextField
                label="Reason for creating anyway"
                value={overrideReason}
                onChange={setOverrideReason}
                help="Recorded in the audit trail."
              />
              <div className="btn-row">
                <button className="btn secondary" onClick={() => setDuplicates(null)}>
                  Cancel
                </button>
                <button
                  className="btn"
                  disabled={busy || !overrideReason.trim()}
                  onClick={() => {
                    setDuplicates(null)
                    void save(true)
                  }}
                >
                  Create anyway
                </button>
              </div>
            </>
          ) : (
            <>
              <AlertBox tone="warn" title="You cannot override this warning">
                Ask a data officer, medical director or administrator to register this participant
                if they are genuinely a different person.
              </AlertBox>
              <button className="btn block secondary" onClick={() => setDuplicates(null)}>
                Go back
              </button>
            </>
          )}
        </Modal>
      ) : null}
    </>
  )
}

export function ConsentPanel({
  participantId,
  onRecorded,
}: {
  participantId: number
  onRecorded: () => void
}) {
  const { user } = useApp()
  const toast = useToast()
  const [status, setStatus] = useState('GIVEN')
  const [by, setBy] = useState(user?.full_name ?? '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const { recordConsent } = await import('../../db/repo/participants')
      await recordConsent(participantId, status, by, notes)
      toast('ok', 'Consent recorded.')
      onRecorded()
    } catch (err) {
      toast('danger', friendlyError(err, 'Consent could not be recorded.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ChoiceGroup
        label="Consent status"
        value={status}
        onChange={setStatus}
        options={CONSENT_STATUSES.map((x) => ({ value: x, label: labelFor(x) }))}
      />
      <TextField label="Obtained by" value={by} onChange={setBy} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      <button className="btn block" onClick={submit} disabled={busy || !by.trim()}>
        Record consent
      </button>
    </>
  )
}

export { Toggle }
