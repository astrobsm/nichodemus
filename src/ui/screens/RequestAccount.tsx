/**
 * Asking an administrator for an account.
 *
 * A new member of staff turning up on the day has no credentials and no way
 * to get any except by finding the administrator and interrupting them. This
 * lets them ask from their own phone instead.
 *
 * What it is NOT is a way to get in. Submitting this grants nothing at all:
 * it writes an application that an administrator has to look at and approve
 * before any account exists. That distinction is the whole design — the
 * records behind this sign-in screen are people's medical records, and the
 * decision about who may read them stays with a person.
 *
 * The PIN chosen here is hashed on this device and only the derivation is
 * sent, so the administrator approving the request never learns it either.
 */
import { useState } from 'react'
import {
  AlertBox,
  SelectField,
  TextArea,
  TextField,
  friendlyError,
} from '../components/ui'
import { requestAccount } from '../../services/cloudAuth'
import { deviceId } from '../../core/ids'
import { validatePin, firstError, required } from '../../core/validation'
import { ROLE_DEFINITIONS } from '../../core/permissions'

export function RequestAccountPanel({
  endpoint,
  onDone,
}: {
  endpoint: string
  onDone: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  function problem(): string | null {
    const r = firstError(required(fullName, 'Your full name'), required(username, 'A username'))
    if (!r.ok) return r.message ?? null
    const p = validatePin(pin)
    if (!p.ok) return p.message ?? null
    if (pin !== pinConfirm) return 'The two PINs do not match.'
    return null
  }

  async function submit() {
    const invalid = problem()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const message = await requestAccount(endpoint, {
        fullName,
        username,
        pin,
        roleRequested: role || undefined,
        phone: phone || undefined,
        reason: reason || undefined,
        deviceId: deviceId(),
      })
      setSent(message)
    } catch (err) {
      setError(friendlyError(err, 'The request could not be sent.'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <>
        <AlertBox tone="ok" title="Request sent">
          {sent}
        </AlertBox>
        <p className="hint">
          Nothing happens on this device until it is approved. When it is, sign in here with the
          username and PIN you just chose — they do not change.
        </p>
        <button className="btn block large" onClick={onDone}>
          Back to sign in
        </button>
      </>
    )
  }

  return (
    <>
      <AlertBox tone="info" title="An administrator has to approve this">
        Sending this does not create an account or give you access to anything. Someone running
        the outreach reviews it first and decides what you may see.
      </AlertBox>

      <TextField label="Your full name" value={fullName} onChange={setFullName} required autoFocus />
      <TextField
        label="Username you would like"
        value={username}
        onChange={setUsername}
        required
        help="Short and easy to type, for example ngozi or dr.eze."
      />
      <SelectField
        label="What you do"
        value={role}
        onChange={setRole}
        options={[
          { value: '', label: 'Not sure — let the administrator decide' },
          ...ROLE_DEFINITIONS.filter((r) => r.code !== 'ADMINISTRATOR').map((r) => ({
            value: r.code,
            label: r.name,
          })),
        ]}
        help="A suggestion only. The administrator sets what you can actually do."
      />
      <TextField label="Telephone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
      <TextArea
        label="Anything the administrator should know"
        value={reason}
        onChange={setReason}
      />

      <TextField
        label="Choose a PIN (4 to 12 digits)"
        value={pin}
        onChange={setPin}
        type="password"
        inputMode="numeric"
        maxLength={12}
        required
        help="Only you will know it. It is scrambled on this phone before anything is sent — nobody, including the administrator, can read it."
      />
      <TextField
        label="Confirm PIN"
        value={pinConfirm}
        onChange={setPinConfirm}
        type="password"
        inputMode="numeric"
        maxLength={12}
        required
      />

      {error ? (
        <AlertBox tone="danger" title="Could not send the request">
          {error}
        </AlertBox>
      ) : null}

      <button className="btn block large" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Sending…' : 'Send request to the administrator'}
      </button>
      <div style={{ height: 10 }} />
      <button className="btn block ghost" onClick={onDone} disabled={busy}>
        Cancel
      </button>
    </>
  )
}
