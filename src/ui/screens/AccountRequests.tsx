/**
 * People who have asked for an account, and what the administrator does
 * about them.
 *
 * Approving one creates a real account with real access to patient records,
 * so nothing here happens on its own and nothing is pre-selected as safe.
 * The administrator picks the role deliberately, and the panel says plainly
 * what approving will mean.
 */
import { useState } from 'react'
import { useApp, useQuery } from '../AppState'
import {
  AlertBox,
  Badge,
  Card,
  Modal,
  SelectField,
  TextField,
  friendlyError,
  useToast,
} from '../components/ui'
import {
  claimAccountRequest,
  decideAccountRequest,
  listAccountRequests,
  type AccountRequest,
} from '../../services/cloudAuth'
import { createApprovedUser } from '../../db/repo/users'
import { isSyncConfigured, runSync, syncConfig } from '../../services/sync'
import { ROLE_DEFINITIONS, roleName, type RoleCode } from '../../core/permissions'
import { relativeDateTime } from '../../core/datetime'

export function AccountRequests() {
  const { refresh, user } = useApp()
  const toast = useToast()
  const config = useQuery(() => syncConfig(), [])
  const [requests, setRequests] = useState<AccountRequest[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<AccountRequest | null>(null)
  const [role, setRole] = useState<RoleCode>('VOLUNTEER')
  const [rejecting, setRejecting] = useState<AccountRequest | null>(null)
  const [note, setNote] = useState('')

  const connected = config.endpoint !== '' && config.token !== ''

  async function load() {
    if (!connected) return
    setBusy(true)
    setError(null)
    try {
      setRequests(await listAccountRequests(config.endpoint, config.token))
    } catch (err) {
      setError(friendlyError(err, 'The requests could not be fetched.'))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!deciding) return
    setBusy(true)
    try {
      // Fetch the PIN derivation the person produced on their own device, so
      // the account they get is the one they already know the PIN for.
      const claimed = await claimAccountRequest(config.endpoint, config.token, deciding.uuid)
      await createApprovedUser({
        username: claimed.username,
        fullName: claimed.fullName,
        role,
        phone: claimed.phone ?? undefined,
        pin: claimed.pin,
        approvedBy: user?.full_name ?? user?.username ?? 'an administrator',
      })
      await decideAccountRequest(
        config.endpoint,
        config.token,
        deciding.uuid,
        'APPROVED',
        user?.full_name ?? user?.username ?? 'an administrator',
      )

      // Push it up straight away. Until the account reaches the cloud the
      // person still cannot sign in, and telling them they are approved while
      // nothing works is worse than not telling them at all.
      let synced = false
      try {
        if (isSyncConfigured()) {
          await runSync()
          synced = true
        }
      } catch {
        /* reported in the message below */
      }

      setDeciding(null)
      refresh()
      await load()
      toast(
        synced ? 'ok' : 'warn',
        synced
          ? `${claimed.fullName} can now sign in.`
          : `${claimed.fullName} was approved, but this device could not synchronise. They cannot sign in until it does.`,
      )
    } catch (err) {
      toast('danger', friendlyError(err, 'The request could not be approved.'))
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!rejecting) return
    setBusy(true)
    try {
      await decideAccountRequest(
        config.endpoint,
        config.token,
        rejecting.uuid,
        'REJECTED',
        user?.full_name ?? user?.username ?? 'an administrator',
        note,
      )
      setRejecting(null)
      setNote('')
      await load()
      toast('ok', 'Request declined.')
    } catch (err) {
      toast('danger', friendlyError(err, 'The request could not be declined.'))
    } finally {
      setBusy(false)
    }
  }

  if (!connected) {
    return (
      <Card title="Account requests">
        <AlertBox tone="muted" title="Not available yet">
          People can only ask for an account once this outreach is in the cloud. Set the web
          address and device key under Cloud sync first.
        </AlertBox>
      </Card>
    )
  }

  return (
    <>
      <Card
        title="Account requests"
        action={
          <button className="btn small secondary" onClick={() => void load()} disabled={busy}>
            {busy ? 'Checking…' : requests ? 'Refresh' : 'Check'}
          </button>
        }
      >
        {error ? (
          <AlertBox tone="danger" title="Could not reach the cloud">
            {error}
          </AlertBox>
        ) : null}

        {requests === null ? (
          <p className="hint" style={{ marginTop: 0 }}>
            People who open the application without an account can ask for one. Check here for
            anyone waiting.
          </p>
        ) : requests.length === 0 ? (
          <p className="hint" style={{ marginTop: 0 }}>
            Nobody is waiting.
          </p>
        ) : (
          requests.map((r) => (
            <div
              key={r.uuid}
              className="list-item"
              style={{ cursor: 'default', alignItems: 'flex-start' }}
            >
              <span className="grow">
                <span className="primary">{r.fullName}</span>
                <span className="secondary">
                  wants the username {r.username}
                  {r.roleRequested ? ` · says they are ${roleName(r.roleRequested)}` : ''}
                </span>
                <span className="secondary">
                  Asked {relativeDateTime(r.requestedAt)}
                  {r.phone ? ` · ${r.phone}` : ''}
                </span>
                {r.reason ? <span className="secondary">{r.reason}</span> : null}
                {r.usernameTaken ? (
                  <Badge tone="danger">That username is already taken</Badge>
                ) : null}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  className="btn small"
                  disabled={r.usernameTaken}
                  onClick={() => {
                    setRole((r.roleRequested as RoleCode) ?? 'VOLUNTEER')
                    setDeciding(r)
                  }}
                >
                  Review
                </button>
                <button className="btn small secondary" onClick={() => setRejecting(r)}>
                  Decline
                </button>
              </span>
            </div>
          ))
        )}
      </Card>

      {deciding ? (
        <Modal
          title={`Approve ${deciding.fullName}?`}
          subtitle={`They will sign in as ${deciding.username}`}
          onClose={() => setDeciding(null)}
        >
          <AlertBox tone="warn" title="This gives a real person access to patient records">
            Approve only if you know who this is. Check with them in person or by telephone first —
            anyone who can open the web address can send one of these.
          </AlertBox>

          <SelectField
            label="Role"
            value={role}
            onChange={(v) => setRole(v as RoleCode)}
            options={ROLE_DEFINITIONS.map((r) => ({ value: r.code, label: r.name }))}
            help={ROLE_DEFINITIONS.find((r) => r.code === role)?.description}
          />
          <p className="hint">
            Give the narrowest role that lets them do their job. You can change it afterwards under
            Users.
          </p>

          <div className="btn-row">
            <button className="btn secondary" onClick={() => setDeciding(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn" onClick={() => void approve()} disabled={busy}>
              {busy ? 'Approving…' : 'Approve and create the account'}
            </button>
          </div>
        </Modal>
      ) : null}

      {rejecting ? (
        <Modal title={`Decline ${rejecting.fullName}?`} onClose={() => setRejecting(null)}>
          <p style={{ marginTop: 0 }}>
            No account is created. They can ask again if this was a mistake.
          </p>
          <TextField
            label="Reason (optional, for your own record)"
            value={note}
            onChange={setNote}
          />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => void reject()} disabled={busy}>
              {busy ? 'Declining…' : 'Decline'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
