/**
 * Telling somebody their account is ready.
 *
 * Shown once, immediately after an account is created or approved. The
 * temporary PIN is visible here and nowhere else ever again — only its
 * derivation is stored — so the panel does not let itself be dismissed
 * quietly while the administrator still has something to pass on.
 */
import { useState } from 'react'
import { AlertBox, Card, TextField, friendlyError, useToast } from '../components/ui'
import {
  DEFAULT_COUNTRY_CODE,
  composeMessage,
  copyMessage,
  normaliseNumber,
  openWhatsApp,
} from '../../services/whatsapp'

export interface CredentialHandover {
  fullName: string
  username: string
  phone: string | null
  /** Absent when the person already chose their own PIN. */
  pin?: string
  expiresAt?: string
}

export function SendCredentials({
  handover,
  outreach,
  webAddress,
  onDone,
}: {
  handover: CredentialHandover
  outreach: string
  webAddress?: string
  onDone: () => void
}) {
  const toast = useToast()
  const [phone, setPhone] = useState(handover.phone ?? '')
  const [sent, setSent] = useState(false)

  const message = composeMessage({
    fullName: handover.fullName,
    username: handover.username,
    outreach,
    pin: handover.pin,
    expiresAt: handover.expiresAt,
    webAddress,
  })
  const reachable = normaliseNumber(phone) !== null

  function send() {
    try {
      const opened = openWhatsApp(phone, message)
      if (!opened) {
        toast('danger', 'WhatsApp could not be opened. Copy the message and send it another way.')
        return
      }
      // WhatsApp is now open with the message ready. It is not sent until the
      // administrator presses send there, so say that rather than "sent".
      setSent(true)
    } catch (err) {
      toast('danger', friendlyError(err, 'That number could not be used.'))
    }
  }

  return (
    <>
      <Card title={`${handover.fullName} can now sign in`}>
        {handover.pin ? (
          <>
            <AlertBox tone="warn" title="This PIN is shown once and never again">
              Only a scrambled form of it is kept, so nobody — including you — can look it up
              later. Pass it on now.
            </AlertBox>
            <div className="credential-row">
              <span>Username</span>
              <strong>{handover.username}</strong>
            </div>
            <div className="credential-row">
              <span>Temporary PIN</span>
              <strong className="credential-pin">{handover.pin}</strong>
            </div>
            <p className="hint">
              They must choose their own PIN the first time they sign in, and this one stops
              working on its own after two days — so a message left sitting in a chat does not
              stay usable.
            </p>
          </>
        ) : (
          <>
            <div className="credential-row">
              <span>Username</span>
              <strong>{handover.username}</strong>
            </div>
            <p className="hint">
              They sign in with the PIN they chose when they asked for the account. Nobody else
              knows it, so there is no PIN to send.
            </p>
          </>
        )}
      </Card>

      <Card title="Send it on WhatsApp">
        <TextField
          label="Their WhatsApp number"
          value={phone}
          onChange={setPhone}
          type="tel"
          inputMode="tel"
          help={`Written any way you like — 0803… or ${DEFAULT_COUNTRY_CODE}803… both work.`}
        />

        <div className="message-preview">{message}</div>

        <button className="btn block large" onClick={send} disabled={!reachable}>
          Open WhatsApp with this message
        </button>
        <p className="hint">
          This opens WhatsApp with the message written and addressed. You press send there —
          nothing is sent from this application on its own.
        </p>

        <button
          className="btn block secondary"
          onClick={async () => {
            const copied = await copyMessage(message)
            toast(
              copied ? 'ok' : 'danger',
              copied
                ? 'Message copied.'
                : 'The message could not be copied. Select it above instead.',
            )
          }}
        >
          Copy the message instead
        </button>

        {sent ? (
          <AlertBox tone="info" title="WhatsApp was opened">
            Check that you pressed send there. Nothing about this account changes either way.
          </AlertBox>
        ) : null}

        <div style={{ height: 10 }} />
        <button className="btn block ghost" onClick={onDone}>
          {handover.pin ? 'Done — I have passed the PIN on' : 'Done'}
        </button>
      </Card>
    </>
  )
}
