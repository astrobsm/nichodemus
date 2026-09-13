/**
 * Handing someone their sign-in details over WhatsApp.
 *
 * WHAT THIS DOES AND DOES NOT DO
 * -----------------------------
 * It opens WhatsApp with the message already written and addressed, and the
 * administrator presses send. It does not, and cannot, send anything by
 * itself: sending without a person in the loop needs the WhatsApp Business
 * API, which costs money, requires an approved business account and only
 * permits pre-registered message templates. Pretending otherwise would mean
 * an administrator believing a nurse had been told when nobody had.
 *
 * That the administrator is the sender is also the right shape. The message
 * arrives from a person the nurse knows, in a conversation she can reply to.
 *
 * ON PUTTING A PIN IN A CHAT MESSAGE
 * ----------------------------------
 * It is a poor place for a credential and there is no way to unsend one. The
 * PIN is therefore made to stop mattering rather than kept secret: it must be
 * changed at first sign-in and it expires on its own (see issueTemporaryPin).
 * The message says so, so the person knows to change it rather than settling
 * in with a PIN that is sitting in two phones' history.
 */

/** Dialling code assumed when a number is written in local form. */
export const DEFAULT_COUNTRY_CODE = '234'

export class WhatsAppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppError'
  }
}

/**
 * Turns a number as people actually write it into the digits WhatsApp wants.
 *
 * Nigerian numbers are written 0803 000 0123 locally and 234 803 000 0123
 * internationally; both must reach the same conversation, or the message goes
 * to a stranger or nowhere.
 */
export function normaliseNumber(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 7) return null

  // Already international, with or without the 00 prefix.
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith(countryCode) && digits.length > countryCode.length + 6) return digits

  // Local form: a single leading zero stands in for the dialling code.
  if (digits.startsWith('0')) return countryCode + digits.slice(1)

  // A bare subscriber number, as people often write it.
  if (digits.length <= 10) return countryCode + digits

  return digits
}

export interface Credentials {
  fullName: string
  username: string
  outreach: string
  /** Omitted when the person already chose their own PIN. */
  pin?: string
  expiresAt?: string
  webAddress?: string
}

/** The message an administrator sends. Plain text: WhatsApp takes no markup. */
export function composeMessage(c: Credentials): string {
  const lines = [
    `Hello ${c.fullName.split(' ')[0] || c.fullName},`,
    '',
    `Your account for ${c.outreach} has been approved.`,
    '',
    `Username: ${c.username}`,
  ]

  if (c.pin) {
    lines.push(`Temporary PIN: ${c.pin}`)
    lines.push('')
    lines.push(
      'You will be asked to choose your own PIN the first time you sign in. Please do that straight away, and then delete this message.',
    )
    if (c.expiresAt) {
      const when = new Date(c.expiresAt)
      lines.push(
        `This temporary PIN stops working on ${when.toLocaleDateString()} at ${when.toLocaleTimeString(
          [],
          { hour: '2-digit', minute: '2-digit' },
        )}.`,
      )
    }
  } else {
    lines.push('')
    lines.push('Sign in with the PIN you chose when you asked for the account. It has not changed.')
  }

  if (c.webAddress) {
    lines.push('')
    lines.push(`Open: ${c.webAddress}`)
  }

  lines.push('')
  lines.push('Do not share these details with anyone.')
  return lines.join('\n')
}

/**
 * The link that opens WhatsApp with this message ready to send.
 *
 * wa.me is WhatsApp's own scheme and works from the browser, the Android
 * application and the desktop build without any account or key.
 */
export function whatsappLink(phone: string, message: string, countryCode?: string): string {
  const number = normaliseNumber(phone, countryCode)
  if (!number) throw new WhatsAppError('That telephone number does not look complete.')
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

/** Opens WhatsApp. Returns false when the window could not be opened. */
export function openWhatsApp(phone: string, message: string, countryCode?: string): boolean {
  const url = whatsappLink(phone, message, countryCode)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) return true

  // A blocked pop-up must not look like a sent message.
  try {
    window.location.href = url
    return true
  } catch {
    return false
  }
}

/** Puts the message on the clipboard, for sending some other way. */
export async function copyMessage(message: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(message)
    return true
  } catch {
    return false
  }
}
