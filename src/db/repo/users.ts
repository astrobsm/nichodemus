/** User accounts and local PIN authentication (spec S14, S50, S88). */
import { query, queryOne, count, transaction } from '../sqlite'
import { insertEnvelope, insertRow, nullIfBlank, softDelete, updateEnvelope, updateRow, boolInt } from './base'
import { hashPin, verifyPin, PIN_ITERATIONS } from '../../core/crypto'
import { nowIso, toIso } from '../../core/datetime'
import { audit, AUDIT_ACTIONS, setAuditActor } from '../../core/audit'
import { ROLES, type RoleCode } from '../../core/permissions'

export interface User {
  id: number
  uuid: string
  username: string
  full_name: string
  role_code: RoleCode
  phone: string | null
  email: string | null
  is_active: number
  must_change_pin: number
  failed_attempts: number
  locked_until: string | null
  last_login_at: string | null
  team_member_id: number | null
  created_at: string
  updated_at: string
  version: number
}

interface UserSecret extends User {
  pin_hash: string
  pin_salt: string
  pin_iterations: number
  /** Set only while a temporary PIN issued by an administrator is in force. */
  pin_expires_at: string | null
}

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 5

export function userCount(): number {
  return count('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL')
}

export function hasAdministrator(): boolean {
  return (
    count(
      `SELECT COUNT(*) AS c FROM users
        WHERE deleted_at IS NULL AND is_active = 1 AND role_code = ?`,
      [ROLES.ADMINISTRATOR],
    ) > 0
  )
}

export function listUsers(includeInactive = true): User[] {
  const clause = includeInactive ? '' : 'AND is_active = 1'
  return query<User>(
    `SELECT id, uuid, username, full_name, role_code, phone, email, is_active,
            must_change_pin, failed_attempts, locked_until, last_login_at,
            team_member_id, created_at, updated_at, version
       FROM users WHERE deleted_at IS NULL ${clause} ORDER BY full_name`,
  )
}

export function getUser(id: number): User | null {
  return queryOne<User>(
    `SELECT id, uuid, username, full_name, role_code, phone, email, is_active,
            must_change_pin, failed_attempts, locked_until, last_login_at,
            team_member_id, created_at, updated_at, version
       FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
}

function getSecret(username: string): UserSecret | null {
  return queryOne<UserSecret>(
    'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
    [username.trim()],
  )
}

export function usernameTaken(username: string, exceptId?: number): boolean {
  const rows = query<{ id: number }>(
    'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL',
    [username.trim()],
  )
  return rows.some((r) => r.id !== exceptId)
}

export interface NewUserInput {
  username: string
  fullName: string
  role: RoleCode
  pin: string
  phone?: string
  email?: string
  teamMemberId?: number | null
  mustChangePin?: boolean
}

export async function createUser(input: NewUserInput): Promise<number> {
  const username = input.username.trim()
  if (!username) throw new Error('A username is required.')
  if (usernameTaken(username)) {
    throw new Error(`The username "${username}" is already in use. Choose another.`)
  }
  const pin = await hashPin(input.pin, PIN_ITERATIONS)

  return transaction(() => {
    const id = insertRow('users', {
      ...insertEnvelope(),
      username,
      full_name: input.fullName.trim(),
      role_code: input.role,
      pin_hash: pin.hash,
      pin_salt: pin.salt,
      pin_iterations: pin.iterations,
      phone: nullIfBlank(input.phone),
      email: nullIfBlank(input.email),
      is_active: 1,
      must_change_pin: boolInt(input.mustChangePin),
      failed_attempts: 0,
      team_member_id: input.teamMemberId ?? null,
    })
    audit({
      action: AUDIT_ACTIONS.USER_CREATE,
      entityType: 'user',
      entityId: id,
      summary: `User account "${username}" created with role ${input.role}`,
    })
    return id
  })
}

/**
 * Creates an account from a request the person made themselves.
 *
 * Takes the PIN derivation they produced on their own device rather than a
 * PIN, so the account they get is the one they already know the PIN for. It
 * is the same PBKDF2 record createUser would have produced; the PIN itself
 * has never existed anywhere but on their device.
 *
 * Only ever called after an administrator has approved the request.
 */
export async function createApprovedUser(input: {
  username: string
  fullName: string
  role: string
  phone?: string
  pin: { hash: string; salt: string; iterations: number }
  approvedBy: string
}): Promise<number> {
  const username = input.username.trim()
  if (!username) throw new Error('A username is required.')
  if (usernameTaken(username)) {
    throw new Error(`The username "${username}" is already in use. Reject this request, or ask them to choose another.`)
  }
  if (!(input.pin.iterations >= 10_000 && input.pin.iterations <= 1_000_000)) {
    throw new Error('That request does not carry a usable PIN. Ask the person to request again.')
  }

  return transaction(() => {
    const id = insertRow('users', {
      ...insertEnvelope(),
      username,
      full_name: input.fullName.trim(),
      role_code: input.role,
      pin_hash: input.pin.hash,
      pin_salt: input.pin.salt,
      pin_iterations: input.pin.iterations,
      phone: nullIfBlank(input.phone),
      is_active: 1,
      // They chose this PIN themselves, so there is nothing to change.
      must_change_pin: 0,
      failed_attempts: 0,
    })
    audit({
      action: AUDIT_ACTIONS.USER_CREATE,
      entityType: 'user',
      entityId: id,
      summary: `Account "${username}" approved by ${input.approvedBy} with role ${input.role}, from a request the person submitted`,
    })
    return id
  })
}

/** How long a PIN sent to somebody stays usable. */
export const TEMPORARY_PIN_HOURS = 48

/**
 * A temporary PIN, issued by an administrator so it can be sent to the person.
 *
 * Six digits from the system's cryptographic random source, never a pattern
 * anybody could guess from the person's name or the date. It is returned in
 * the clear exactly once, to the administrator who issued it, and is not
 * recoverable afterwards - only its PBKDF2 derivation is stored, like every
 * other PIN in this application.
 *
 * Two things make it safe enough to send through a chat application, which is
 * otherwise a poor place for a credential: it has to be changed at first
 * sign-in, and it stops working after TEMPORARY_PIN_HOURS whether it is used
 * or not. A message nobody can unsend therefore stops mattering on its own.
 */
export async function issueTemporaryPin(
  userId: number,
  issuedBy: string,
): Promise<{ pin: string; expiresAt: string }> {
  const digits = new Uint32Array(6)
  crypto.getRandomValues(digits)
  const pin = [...digits].map((d) => d % 10).join('')

  const derived = await hashPin(pin, PIN_ITERATIONS)
  const expiresAt = toIso(new Date(Date.now() + TEMPORARY_PIN_HOURS * 60 * 60_000))
  const before = getUser(userId)

  await transaction(() => {
    updateRow('users', userId, {
      ...updateEnvelope(before?.version),
      pin_hash: derived.hash,
      pin_salt: derived.salt,
      pin_iterations: derived.iterations,
      must_change_pin: 1,
      pin_expires_at: expiresAt,
      failed_attempts: 0,
      locked_until: null,
    })
    audit({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      // The PIN itself is never written here, only the fact of issuing one.
      summary: `Temporary PIN issued by ${issuedBy}, expires ${expiresAt}`,
    })
  })

  return { pin, expiresAt }
}


export async function changePin(userId: number, newPin: string): Promise<void> {
  const pin = await hashPin(newPin, PIN_ITERATIONS)
  const before = getUser(userId)
  await transaction(() => {
    updateRow('users', userId, {
      ...updateEnvelope(before?.version),
      pin_hash: pin.hash,
      pin_salt: pin.salt,
      pin_iterations: pin.iterations,
      must_change_pin: 0,
      // The PIN is now one only this person knows, so there is nothing left
      // to expire.
      pin_expires_at: null,
      failed_attempts: 0,
      locked_until: null,
    })
    audit({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      summary: 'PIN changed',
    })
  })
}

export async function updateUser(
  userId: number,
  patch: { fullName?: string; role?: RoleCode; phone?: string; email?: string; isActive?: boolean },
): Promise<void> {
  const before = getUser(userId)
  if (!before) throw new Error('That user account no longer exists.')
  await transaction(() => {
    updateRow('users', userId, {
      ...updateEnvelope(before.version),
      full_name: patch.fullName ?? before.full_name,
      role_code: patch.role ?? before.role_code,
      phone: patch.phone !== undefined ? nullIfBlank(patch.phone) : before.phone,
      email: patch.email !== undefined ? nullIfBlank(patch.email) : before.email,
      is_active: patch.isActive === undefined ? before.is_active : boolInt(patch.isActive),
    })
    audit({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      summary: `User "${before.username}" updated`,
      previousValue: { role: before.role_code, active: before.is_active },
      newValue: { role: patch.role ?? before.role_code, active: patch.isActive },
    })
  })
}

export async function deactivateUser(userId: number): Promise<void> {
  const user = getUser(userId)
  if (!user) return
  if (user.role_code === ROLES.ADMINISTRATOR) {
    const admins = count(
      `SELECT COUNT(*) AS c FROM users
        WHERE deleted_at IS NULL AND is_active = 1 AND role_code = ?`,
      [ROLES.ADMINISTRATOR],
    )
    if (admins <= 1) {
      throw new Error(
        'This is the only active administrator account. Create another administrator before ' +
          'deactivating this one.',
      )
    }
  }
  await transaction(() => {
    softDelete('users', userId)
    audit({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      summary: `User "${user.username}" deactivated`,
    })
  })
}

export type LoginResult =
  | { ok: true; user: User; mustChangePin: boolean }
  | { ok: false; reason: string; lockedUntil?: string; attemptsRemaining?: number }

/**
 * Verifies a username and PIN against the local store. After
 * MAX_FAILED_ATTEMPTS the account is locked for LOCKOUT_MINUTES.
 */
export async function login(username: string, pin: string): Promise<LoginResult> {
  const secret = getSecret(username)
  if (!secret || !secret.is_active) {
    await transaction(() => {
      audit({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'user',
        entityId: username,
        summary: 'Sign-in failed: unknown or inactive account',
      })
    })
    return { ok: false, reason: 'That username or PIN is not correct.' }
  }

  // Compare as instants: locked_until and "now" must never be compared as
  // strings, because a UTC and a local-offset timestamp do not sort together.
  if (secret.locked_until && new Date(secret.locked_until).getTime() > Date.now()) {
    return {
      ok: false,
      reason: 'This account is temporarily locked after repeated incorrect PIN entries.',
      lockedUntil: secret.locked_until,
    }
  }

  const valid = await verifyPin(pin, {
    hash: secret.pin_hash,
    salt: secret.pin_salt,
    iterations: Number(secret.pin_iterations),
  })

  if (valid && secret.pin_expires_at && new Date(secret.pin_expires_at).getTime() <= Date.now()) {
    // Checked only once the PIN is known to be right: answering "expired"
    // to a wrong PIN would confirm to a guesser that the account exists and
    // that a temporary PIN was issued for it.
    await transaction(() => {
      audit({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'user',
        entityId: secret.id,
        summary: 'Sign-in refused: the temporary PIN had expired',
      })
    })
    return {
      ok: false,
      reason:
        'That temporary PIN has expired. Ask your administrator to send you a new one.',
    }
  }

  if (!valid) {
    const attempts = Number(secret.failed_attempts) + 1
    const lock =
      attempts >= MAX_FAILED_ATTEMPTS
        ? toIso(new Date(Date.now() + LOCKOUT_MINUTES * 60_000))
        : null
    await transaction(() => {
      updateRow('users', secret.id, { failed_attempts: attempts, locked_until: lock })
      audit({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'user',
        entityId: secret.id,
        summary: `Sign-in failed (attempt ${attempts})`,
      })
    })
    if (lock) {
      return {
        ok: false,
        reason:
          `That PIN is not correct. This account is now locked for ${LOCKOUT_MINUTES} minutes.`,
        lockedUntil: lock,
      }
    }
    return {
      ok: false,
      reason: 'That username or PIN is not correct.',
      attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts,
    }
  }

  const user = getUser(secret.id)!
  setAuditActor({ id: user.id, username: user.username, role: user.role_code })
  await transaction(() => {
    updateRow('users', secret.id, {
      failed_attempts: 0,
      locked_until: null,
      last_login_at: nowIso(),
    })
    audit({
      action: AUDIT_ACTIONS.LOGIN,
      entityType: 'user',
      entityId: user.id,
      summary: `${user.full_name} signed in`,
    })
  })

  return { ok: true, user, mustChangePin: Number(secret.must_change_pin) === 1 }
}

export async function recordLogout(user: User | null): Promise<void> {
  if (!user) return
  await transaction(() => {
    audit({
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'user',
      entityId: user.id,
      summary: `${user.full_name} signed out`,
    })
  })
}

/** Re-verifies a PIN without changing session state - used by the app lock. */
export async function verifyUserPin(userId: number, pin: string): Promise<boolean> {
  const secret = queryOne<UserSecret>('SELECT * FROM users WHERE id = ?', [userId])
  if (!secret) return false
  return verifyPin(pin, {
    hash: secret.pin_hash,
    salt: secret.pin_salt,
    iterations: Number(secret.pin_iterations),
  })
}

/**
 * Administrator PIN reset for another user. The new PIN must be changed by
 * its owner at next sign-in.
 */
export async function resetPin(userId: number, newPin: string): Promise<void> {
  const pin = await hashPin(newPin, PIN_ITERATIONS)
  const before = getUser(userId)
  await transaction(() => {
    updateRow('users', userId, {
      ...updateEnvelope(before?.version),
      pin_hash: pin.hash,
      pin_salt: pin.salt,
      pin_iterations: pin.iterations,
      must_change_pin: 1,
      failed_attempts: 0,
      locked_until: null,
    })
    audit({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      summary: 'PIN reset by administrator; user must set a new PIN at next sign-in',
    })
  })
}
