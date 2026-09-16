/**
 * PhraseVault PIN lock.
 *
 * Owns every key, every envelope and all session state. Nothing outside this
 * file touches crypto. The PIN is portable: KDF parameters and the wrapped data
 * key live in the SQLite file, so the same PIN opens the database on every
 * machine that can read the file. That also means a copied file can be attacked
 * offline — the app-side retry delay is not a defence against that, and the UI
 * says so.
 *
 * Dependencies are injected (setVaultDb / setVaultConfigAccess /
 * setVaultBroadcast) rather than imported, so this module stays free of Electron
 * and of database.ts, and its tests are pure Node.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import * as nodeCrypto from 'node:crypto'
import type { VaultStatus } from '../types'

export type VaultErrorCode =
  | 'locked'
  | 'no-pin'
  | 'has-pin'
  | 'wrong-pin'
  | 'too-short'
  | 'throttled'
  | 'unsupported-kdf'
  | 'corrupt'
  | 'unavailable'

/** The only error type this module throws. `message` is the code, never prose. */
export class VaultError extends Error {
  readonly code: VaultErrorCode
  readonly retryAfterMs?: number

  constructor(code: VaultErrorCode, retryAfterMs?: number) {
    super(code)
    this.name = 'VaultError'
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

export interface ScryptParams {
  N: number
  r: number
  p: number
  maxmem: number
}
export interface Argon2Params {
  t: number
  m: number
  p: number
}
export type KdfName = 'scrypt' | 'argon2id'

export interface KeyEnvelope {
  v: 1
  kdf: KdfName
  params: ScryptParams | Argon2Params
  salt: string
  iv: string
  ct: string
  tag: string
}

export interface RowEnvelope {
  v: 1
  iv: string
  ct: string
  tag: string
}

export const MIN_PIN_LENGTH = 4
/** maxmem must be explicit: Node's 32 MiB default rejects N = 2^17. */
export const SCRYPT_PARAMS: ScryptParams = { N: 131072, r: 8, p: 1, maxmem: 201326592 }
/** m is KiB, so 65536 is 64 MiB. */
export const ARGON2_PARAMS: Argon2Params = { t: 3, m: 65536, p: 1 }

const KEY_AAD = Buffer.from('phrasevault-dek-v1', 'ascii')
const ROW_AAD_PREFIX = 'phrasevault-row-v1:'
const DEK_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Cost parameters are attacker-supplied data: the envelope lives in a file that
 * may have been edited. Only values this build is prepared to spend time and
 * memory on are accepted; anything else is refused *before* a derive, so a
 * hostile N cannot be used as a memory-exhaustion lever.
 */
const ALLOWED_SCRYPT_N = [65536, 131072]
const ALLOWED_SCRYPT_R = [8]
const ALLOWED_SCRYPT_P = [1]
const MAX_SCRYPT_MAXMEM = 268435456
const ALLOWED_ARGON2_T = [2, 3, 4]
const ALLOWED_ARGON2_M = [19456, 32768, 65536]
const ALLOWED_ARGON2_P = [1, 2, 4]

type Argon2TwoArg = (algorithm: string, parameters: Record<string, unknown>) => ArrayBufferView
type Argon2ObjectArg = (options: Record<string, unknown>) => ArrayBufferView

function argon2Derive(
  message: Buffer,
  nonce: Buffer,
  params: { passes: number; memory: number; parallelism: number }
): ArrayBufferView {
  const native = (
    nodeCrypto as unknown as { argon2Sync?: Argon2TwoArg | Argon2ObjectArg }
  ).argon2Sync
  if (typeof native !== 'function') throw new Error('argon2 unavailable')
  const parameters = {
    message,
    nonce,
    tagLength: DEK_BYTES,
    parallelism: params.parallelism,
    memory: params.memory,
    passes: params.passes,
  }
  try {
    return (native as Argon2TwoArg)('argon2id', parameters)
  } catch {
    // Electron 39 throws "Argon2 algorithm not supported" for argon2id.
  }
  try {
    return (native as Argon2ObjectArg)({ algorithm: 'argon2id', ...parameters })
  } catch {
    throw new Error('argon2 unavailable')
  }
}

let argon2Probe: boolean | null = null

/**
 * Detect argon2 by *using* it, not by looking for the function.
 *
 * Electron 39's Node exposes `crypto.argon2Sync` but throws "Argon2 algorithm
 * not supported" when asked for argon2id, so an existence check would pick a
 * KDF that cannot derive anything and would break setup entirely. The probe runs
 * once with deliberately cheap parameters and is cached.
 */
export function argon2Available(): boolean {
  if (argon2Probe !== null) return argon2Probe
  try {
    const out = argon2Derive(Buffer.from('probe', 'ascii'), Buffer.alloc(SALT_BYTES), {
      passes: 2,
      memory: 19456,
      parallelism: 1,
    })
    argon2Probe = out.byteLength === DEK_BYTES
  } catch {
    argon2Probe = false
  }
  return argon2Probe
}

/**
 * The chosen algorithm is recorded in the envelope, so a later runtime that
 * gains a working argon2 upgrades new wraps without silently downgrading or
 * rewrapping an existing one.
 */
export function bestKdf(): KdfName {
  return argon2Available() ? 'argon2id' : 'scrypt'
}

/**
 * NFC then UTF-8. No trimming: whitespace is part of the secret. The minimum is
 * counted in code points, so four emoji are a valid PIN.
 */
export function encodePin(pin: unknown): Buffer {
  if (typeof pin !== 'string') throw new VaultError('too-short')
  const normalized = pin.normalize('NFC')
  if ([...normalized].length < MIN_PIN_LENGTH) throw new VaultError('too-short')
  return Buffer.from(normalized, 'utf8')
}

function allowedInt(value: unknown, allowed: number[]): boolean {
  return typeof value === 'number' && Number.isInteger(value) && allowed.includes(value)
}

export function deriveKey(pin: Buffer, salt: Buffer, kdf: string, params: unknown): Buffer {
  if (kdf === 'scrypt') {
    const p = params as ScryptParams | null
    if (
      !p ||
      !allowedInt(p.N, ALLOWED_SCRYPT_N) ||
      !allowedInt(p.r, ALLOWED_SCRYPT_R) ||
      !allowedInt(p.p, ALLOWED_SCRYPT_P)
    ) {
      throw new VaultError('corrupt')
    }
    const maxmem =
      typeof p.maxmem === 'number' && Number.isInteger(p.maxmem) && p.maxmem > 0 && p.maxmem <= MAX_SCRYPT_MAXMEM
        ? p.maxmem
        : null
    if (p.maxmem !== undefined && maxmem === null) throw new VaultError('corrupt')
    return scryptSync(pin, salt, DEK_BYTES, { N: p.N, r: p.r, p: p.p, maxmem: maxmem ?? SCRYPT_PARAMS.maxmem })
  }
  if (kdf === 'argon2id') {
    if (!argon2Available()) throw new VaultError('unsupported-kdf')
    const p = params as Argon2Params | null
    if (
      !p ||
      !allowedInt(p.t, ALLOWED_ARGON2_T) ||
      !allowedInt(p.m, ALLOWED_ARGON2_M) ||
      !allowedInt(p.p, ALLOWED_ARGON2_P)
    ) {
      throw new VaultError('corrupt')
    }
    const out = argon2Derive(pin, salt, { passes: p.t, memory: p.m, parallelism: p.p })
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
  }
  throw new VaultError('unsupported-kdf')
}

/**
 * Decode standard padded base64 and insist the input is canonical. Buffer.from
 * silently skips whitespace and non-alphabet characters, which would let two
 * different strings decode to the same bytes; re-encoding and comparing closes
 * that off.
 */
function decodeExact(value: unknown, bytes: number): Buffer {
  if (typeof value !== 'string') throw new VaultError('corrupt')
  const buf = Buffer.from(value, 'base64')
  if (buf.length !== bytes) throw new VaultError('corrupt')
  if (buf.toString('base64') !== value) throw new VaultError('corrupt')
  return buf
}

/** Wraps the DEK. Never rotates it — Change PIN rewraps this same key. */
export function wrapDek(dek: Buffer, pin: Buffer, kdf: KdfName = bestKdf()): KeyEnvelope {
  const salt = randomBytes(SALT_BYTES)
  const params: ScryptParams | Argon2Params = kdf === 'scrypt' ? { ...SCRYPT_PARAMS } : { ...ARGON2_PARAMS }
  const key = deriveKey(pin, salt, kdf, params)
  try {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(KEY_AAD)
    const ct = Buffer.concat([cipher.update(dek), cipher.final()])
    return {
      v: 1,
      kdf,
      params,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    }
  } finally {
    key.fill(0)
  }
}

/**
 * A GCM failure here is reported as a wrong PIN. That is a UI policy, not proof:
 * a structurally valid but damaged envelope fails the same way. Anything
 * structurally wrong is corruption, and an unrecognised kdf is refused without
 * modifying the stored envelope.
 */
export function unwrapDek(envelopeJson: string, pin: Buffer): Buffer {
  let parsed: KeyEnvelope
  try {
    parsed = JSON.parse(envelopeJson) as KeyEnvelope
  } catch {
    throw new VaultError('corrupt')
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.kdf !== 'string') throw new VaultError('corrupt')
  if (parsed.kdf !== 'scrypt' && parsed.kdf !== 'argon2id') throw new VaultError('unsupported-kdf')
  if (parsed.kdf === 'argon2id' && !argon2Available()) throw new VaultError('unsupported-kdf')

  const salt = decodeExact(parsed.salt, SALT_BYTES)
  const iv = decodeExact(parsed.iv, IV_BYTES)
  const tag = decodeExact(parsed.tag, TAG_BYTES)
  const ct = decodeExact(parsed.ct, DEK_BYTES)

  const key = deriveKey(pin, salt, parsed.kdf, parsed.params)
  let dek: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(KEY_AAD)
    decipher.setAuthTag(tag)
    dek = Buffer.concat([decipher.update(ct), decipher.final()])
  } catch (error) {
    if (error instanceof VaultError) throw error
    throw new VaultError('wrong-pin')
  } finally {
    key.fill(0)
  }
  if (dek.length !== DEK_BYTES) {
    dek.fill(0)
    throw new VaultError('corrupt')
  }
  return dek
}

/** Binds a ciphertext to its row so it cannot be moved by editing the file. */
function rowAad(shortId: string): Buffer {
  return Buffer.from(ROW_AAD_PREFIX + String(shortId).toLowerCase(), 'ascii')
}

export function encryptRow(dek: Buffer, shortId: string, text: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  cipher.setAAD(rowAad(shortId))
  const ct = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
  const envelope: RowEnvelope = {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
  return JSON.stringify(envelope)
}

/**
 * Any failure here is corruption, never a wrong PIN: by the time a row is
 * decrypted the DEK has already been proven correct by unwrapDek.
 */
export function decryptRow(dek: Buffer, shortId: string, envelopeJson: string): string {
  let parsed: RowEnvelope
  try {
    parsed = JSON.parse(envelopeJson) as RowEnvelope
  } catch {
    throw new VaultError('corrupt')
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.ct !== 'string') throw new VaultError('corrupt')
  const iv = decodeExact(parsed.iv, IV_BYTES)
  const tag = decodeExact(parsed.tag, TAG_BYTES)
  const ct = Buffer.from(parsed.ct, 'base64')
  if (ct.toString('base64') !== parsed.ct) throw new VaultError('corrupt')
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, iv)
    decipher.setAAD(rowAad(shortId))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    throw new VaultError('corrupt')
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface VaultDb {
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>
  run(sql: string, params?: readonly unknown[]): Promise<void>
}

export interface VaultConfigAccess {
  get(): { unlockTimeoutEnabled: boolean; unlockTimeoutMinutes: number }
  set(next: { unlockTimeoutEnabled: boolean; unlockTimeoutMinutes: number }): void
}

/** The main-only row shape. PhraseRow deliberately cannot carry expanded_cipher. */
export interface LockableRow {
  id: number
  short_id: string
  expanded_text: string
  locked: 0 | 1
  expanded_cipher: string | null
}

/** The five values the Security select offers. */
export const TIMEOUT_MINUTES = [5, 15, 60, 240, 1440] as const

/**
 * After five consecutive failures each further attempt waits, capped at 60s.
 * In-memory only: persisting it would punish a legitimate second device while an
 * attacker with the file deletes the counter with a hex editor.
 */
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000] as const

let db: VaultDb | null = null
let configAccess: VaultConfigAccess | null = null
let broadcast: ((status: VaultStatus) => void) | null = null

// Session state. Never serialized, never logged.
let dek: Buffer | null = null
let lockTimer: NodeJS.Timeout | null = null
let failures = 0
let nextAttemptAt = 0
const lockListeners: Array<() => void> = []

/**
 * Bumped by every lock() and every database swap. A long operation captures it
 * before its first await and refuses to install a key or write an envelope if it
 * moved — otherwise a derive started against database A could unlock database B,
 * or resurrect a session the user explicitly locked.
 */
let sessionGeneration = 0

export function setVaultDb(next: VaultDb | null): void {
  lock()
  db = next
  sessionGeneration++
  publish()
}

export function setVaultConfigAccess(next: VaultConfigAccess | null): void {
  configAccess = next
}

export function setVaultBroadcast(next: ((status: VaultStatus) => void) | null): void {
  broadcast = next
}

/** Called on every lock so main can drop the pending prompt slot. */
export function onLock(listener: () => void): void {
  lockListeners.push(listener)
}

export function isUnlocked(): boolean {
  return dek !== null
}

/** Re-read counts and broadcast. Call after add/edit/duplicate/delete. */
export function publishVaultStatus(): void {
  publish()
}

function requireDb(): VaultDb {
  if (!db) throw new VaultError('unavailable')
  return db
}

function requireDek(): Buffer {
  if (!dek) throw new VaultError('locked')
  return dek
}

function timeoutConfig(): { unlockTimeoutEnabled: boolean; unlockTimeoutMinutes: number } {
  return configAccess?.get() ?? { unlockTimeoutEnabled: true, unlockTimeoutMinutes: 15 }
}

async function readEnvelope(database: VaultDb): Promise<string | null> {
  const row = await database.get<{ envelope: string }>('SELECT envelope FROM vault_key WHERE id = 1')
  return row?.envelope ?? null
}

function kdfOf(envelopeJson: string | null): { kdf: string; supported: boolean } {
  if (!envelopeJson) return { kdf: '', supported: true }
  try {
    const parsed = JSON.parse(envelopeJson) as { kdf?: string }
    const kdf = typeof parsed.kdf === 'string' ? parsed.kdf : ''
    if (kdf === 'scrypt') return { kdf, supported: true }
    if (kdf === 'argon2id') return { kdf, supported: bestKdf() === 'argon2id' }
    return { kdf, supported: false }
  } catch {
    return { kdf: '', supported: false }
  }
}

/** Never throws. An unavailable database is a status, not an error. */
export async function getVaultStatus(): Promise<VaultStatus> {
  const config = timeoutConfig()
  const base: VaultStatus = {
    available: false,
    hasPin: false,
    unlocked: false,
    lockedCount: 0,
    timeoutEnabled: config.unlockTimeoutEnabled,
    timeoutMinutes: config.unlockTimeoutMinutes,
    kdfSupported: true,
  }
  const database = db
  if (!database) return base
  try {
    const envelope = await readEnvelope(database)
    const counted = await database.get<{ count: number }>('SELECT COUNT(*) AS count FROM phrases WHERE locked = 1')
    return {
      ...base,
      available: true,
      hasPin: envelope !== null,
      unlocked: dek !== null,
      lockedCount: counted?.count ?? 0,
      kdfSupported: kdfOf(envelope).supported,
    }
  } catch {
    return base
  }
}

function publish(): void {
  if (!broadcast) return
  void getVaultStatus()
    .then((status) => broadcast?.(status))
    .catch(() => {})
}

function clearTimer(): void {
  if (lockTimer) {
    clearTimeout(lockTimer)
    lockTimer = null
  }
}

/**
 * One absolute timeout armed on unlock and re-armed only on a settings change.
 * Using a locked row does not extend it — a sliding TTL is CUT.
 */
function armTimer(): void {
  clearTimer()
  if (!dek) return
  const config = timeoutConfig()
  if (!config.unlockTimeoutEnabled) return
  const minutes = config.unlockTimeoutMinutes
  if (typeof minutes !== 'number' || minutes <= 0) return
  lockTimer = setTimeout(() => {
    lockTimer = null
    lock()
  }, minutes * 60_000)
}

export function lock(): void {
  // Bump first and unconditionally: an unlock already in flight must not install
  // its key after the user asked to lock.
  sessionGeneration++
  clearTimer()
  if (!dek) return
  dek.fill(0)
  dek = null
  for (const listener of lockListeners) listener()
  publish()
}

export function applyTimeoutSetting(): void {
  if (!dek) return
  armTimer()
}

/** Commit the Security panel's timeout draft. Per install, never in the database. */
export function setTimeoutConfig(next: { enabled: boolean; minutes: number }): void {
  configAccess?.set({ unlockTimeoutEnabled: next.enabled, unlockTimeoutMinutes: next.minutes })
}

export async function setupPin(pin: unknown): Promise<void> {
  const database = requireDb()
  const generation = sessionGeneration
  if ((await readEnvelope(database)) !== null) throw new VaultError('has-pin')
  if (generation !== sessionGeneration || db !== database) throw new VaultError('unavailable')
  const encoded = encodePin(pin)
  const fresh = randomBytes(DEK_BYTES)
  let installed = false
  try {
    const envelope = wrapDek(fresh, encoded, bestKdf())
    await database.run('INSERT INTO vault_key (id, envelope) VALUES (1, ?)', [JSON.stringify(envelope)])
    installed = true
    if (generation !== sessionGeneration || db !== database) {
      fresh.fill(0)
      return
    }
    dek = fresh
  } finally {
    encoded.fill(0)
    if (!installed) fresh.fill(0)
  }
  failures = 0
  nextAttemptAt = 0
  armTimer()
  publish()
}

function refuseIfThrottled(): void {
  const remaining = nextAttemptAt - Date.now()
  if (remaining > 0) throw new VaultError('throttled', remaining)
}

/** Failures 1–4 are immediate; from the fifth, each further attempt waits. */
function noteWrongPin(): VaultError {
  failures++
  if (failures >= BACKOFF_MS.length) {
    const step = Math.min(failures - BACKOFF_MS.length, BACKOFF_MS.length - 1)
    nextAttemptAt = Date.now() + BACKOFF_MS[step]
    return new VaultError('wrong-pin', nextAttemptAt - Date.now())
  }
  return new VaultError('wrong-pin')
}

export async function unlock(pin: unknown): Promise<void> {
  const database = requireDb()
  const generation = sessionGeneration
  const envelope = await readEnvelope(database)
  if (envelope === null) throw new VaultError('no-pin')
  if (generation !== sessionGeneration || db !== database) throw new VaultError('unavailable')
  refuseIfThrottled()
  const encoded = encodePin(pin)
  let opened: Buffer
  try {
    opened = unwrapDek(envelope, encoded)
  } catch (error) {
    if (error instanceof VaultError && error.code === 'wrong-pin') throw noteWrongPin()
    throw error
  } finally {
    encoded.fill(0)
  }
  if (generation !== sessionGeneration || db !== database) {
    opened.fill(0)
    throw new VaultError('unavailable')
  }
  dek = opened
  failures = 0
  nextAttemptAt = 0
  armTimer()
  publish()
}

/** Requires the current PIN even while unlocked. The DEK is never rotated. */
export async function changePin(currentPin: unknown, newPin: unknown): Promise<void> {
  const database = requireDb()
  const generation = sessionGeneration
  const envelope = await readEnvelope(database)
  if (envelope === null) throw new VaultError('no-pin')
  if (!kdfOf(envelope).supported) throw new VaultError('unsupported-kdf')
  if (generation !== sessionGeneration || db !== database) throw new VaultError('unavailable')
  refuseIfThrottled()
  const next = encodePin(newPin)
  const current = encodePin(currentPin)
  let existing: Buffer
  try {
    existing = unwrapDek(envelope, current)
  } catch (error) {
    if (error instanceof VaultError && error.code === 'wrong-pin') throw noteWrongPin()
    throw error
  } finally {
    current.fill(0)
  }
  let installed = false
  try {
    const rewrapped = wrapDek(existing, next, bestKdf())
    if (generation !== sessionGeneration || db !== database) throw new VaultError('unavailable')
    await database.run('UPDATE vault_key SET envelope = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [
      JSON.stringify(rewrapped),
    ])
    installed = true
    if (generation !== sessionGeneration || db !== database) {
      existing.fill(0)
      return
    }
    if (dek && dek !== existing) dek.fill(0)
    dek = existing
  } finally {
    next.fill(0)
    if (!installed) existing.fill(0)
  }
  failures = 0
  nextAttemptAt = 0
  armTimer()
  publish()
}

/** Encrypt for a row without writing it — used by add/edit/duplicate in main. */
export function encryptFor(shortId: string, text: string): string {
  return encryptRow(requireDek(), shortId, text)
}

export async function protect(id: number, shortId: string, text: string): Promise<void> {
  const database = requireDb()
  if ((await readEnvelope(database)) === null) throw new VaultError('no-pin')
  const cipher = encryptFor(shortId, text)
  await database.run("UPDATE phrases SET locked = 1, expanded_text = '', expanded_cipher = ? WHERE id = ?", [
    cipher,
    id,
  ])
  publish()
}

export async function unprotect(id: number, text: string): Promise<void> {
  const database = requireDb()
  requireDek()
  await database.run('UPDATE phrases SET locked = 0, expanded_text = ?, expanded_cipher = NULL WHERE id = ?', [
    text,
    id,
  ])
  publish()
}

/** The only decrypt entry point in the app. */
export function revealRow(row: LockableRow): string {
  if (row.locked !== 1) return row.expanded_text
  if (!dek) throw new VaultError('locked')
  if (typeof row.expanded_cipher !== 'string' || row.expanded_cipher.length === 0) {
    throw new VaultError('corrupt')
  }
  return decryptRow(dek, row.short_id, row.expanded_cipher)
}
