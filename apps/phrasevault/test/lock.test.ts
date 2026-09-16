/**
 * lock.ts crypto: envelopes, KDF dispatch, row binding, PIN encoding.
 *
 * Pure node:crypto. No Electron, no sqlite3, no fake filesystem. scrypt at
 * N = 2^17 costs a few hundred ms per derive here, so the wrap/unwrap cases
 * share one envelope wherever they can and carry a raised timeout.
 */
import * as nodeCrypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ARGON2_PARAMS,
  argon2Available,
  MIN_PIN_LENGTH,
  SCRYPT_PARAMS,
  VaultError,
  bestKdf,
  decryptRow,
  deriveKey,
  encodePin,
  encryptRow,
  unwrapDek,
  wrapDek,
} from '../src/services/lock'

/**
 * Usability, not existence: Electron 39 exposes crypto.argon2Sync but throws for
 * argon2id, so a typeof check would claim a KDF that cannot derive anything.
 */
const hasArgon2 = argon2Available()
const argon2FunctionExists = typeof (nodeCrypto as unknown as { argon2Sync?: unknown }).argon2Sync === 'function'
const SLOW = { timeout: 60000 }

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof VaultError ? error.code : `not-a-vault-error:${String(error)}`
  }
  return 'no-throw'
}

describe('constants', () => {
  it('pins the locked KDF parameters', () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 131072, r: 8, p: 1, maxmem: 201326592 })
    expect(ARGON2_PARAMS).toEqual({ t: 3, m: 65536, p: 1 })
    expect(MIN_PIN_LENGTH).toBe(4)
  })
})

describe('encodePin', () => {
  it('rejects fewer than four code points after NFC normalization', () => {
    expect(codeOf(() => encodePin('123'))).toBe('too-short')
    expect(codeOf(() => encodePin(1234 as unknown as string))).toBe('too-short')
    expect(encodePin('1234')).toBeInstanceOf(Buffer)
  })

  it('treats composed and decomposed NFC forms as the same secret', () => {
    // 'e' + combining acute normalizes to the single composed code point.
    expect(encodePin('café').equals(encodePin('café'))).toBe(true)
  })

  it('does not trim: leading and trailing spaces are significant', () => {
    expect(encodePin(' 1234').equals(encodePin('1234 '))).toBe(false)
    expect(encodePin('1234 ').equals(encodePin('1234'))).toBe(false)
  })

  it('counts code points, not UTF-16 units', () => {
    // Four astral code points are eight UTF-16 units and must be accepted.
    expect(codeOf(() => encodePin('\u{1F510}\u{1F511}\u{1F512}\u{1F513}'))).toBe('no-throw')
    expect(codeOf(() => encodePin('\u{1F510}\u{1F511}\u{1F512}'))).toBe('too-short')
  })

  it('allows a weak all-digit PIN: 1234 is not blocked', () => {
    expect(codeOf(() => encodePin('1234'))).toBe('no-throw')
  })
})

describe('key envelope', () => {
  it('round-trips the DEK under scrypt', SLOW, () => {
    const dek = nodeCrypto.randomBytes(32)
    const envelope = wrapDek(dek, encodePin('1234'), 'scrypt')
    expect(envelope.v).toBe(1)
    expect(envelope.kdf).toBe('scrypt')
    expect(envelope.params).toEqual(SCRYPT_PARAMS)
    expect(Buffer.from(envelope.salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16)
    expect(unwrapDek(JSON.stringify(envelope), encodePin('1234')).equals(dek)).toBe(true)
  })

  it.skipIf(!hasArgon2)('round-trips the DEK under argon2id', SLOW, () => {
    const dek = nodeCrypto.randomBytes(32)
    const envelope = wrapDek(dek, encodePin('1234'), 'argon2id')
    expect(envelope.kdf).toBe('argon2id')
    expect(envelope.params).toEqual(ARGON2_PARAMS)
    expect(unwrapDek(JSON.stringify(envelope), encodePin('1234')).equals(dek)).toBe(true)
  })

  it('reports a wrong PIN as wrong-pin, never corrupt', SLOW, () => {
    const envelope = JSON.stringify(wrapDek(nodeCrypto.randomBytes(32), encodePin('1234'), 'scrypt'))
    expect(codeOf(() => unwrapDek(envelope, encodePin('4321')))).toBe('wrong-pin')
  })

  it('reports structural damage as corrupt, never wrong-pin', SLOW, () => {
    const good = wrapDek(nodeCrypto.randomBytes(32), encodePin('1234'), 'scrypt')
    expect(codeOf(() => unwrapDek('not json', encodePin('1234')))).toBe('corrupt')
    expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, v: 2 }), encodePin('1234')))).toBe('corrupt')
    expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, salt: undefined }), encodePin('1234')))).toBe('corrupt')
    // A 15-byte salt is the wrong decoded length, not a wrong PIN.
    const shortSalt = nodeCrypto.randomBytes(15).toString('base64')
    expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, salt: shortSalt }), encodePin('1234')))).toBe('corrupt')
  })

  it('rejects non-canonical or unpadded base64 rather than decoding it loosely', SLOW, () => {
    const good = wrapDek(nodeCrypto.randomBytes(32), encodePin('1234'), 'scrypt')
    const unpadded = good.salt.replace(/=+$/, '')
    if (unpadded !== good.salt) {
      expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, salt: unpadded }), encodePin('1234')))).toBe('corrupt')
    }
    // Whitespace and non-alphabet characters are silently dropped by Buffer.from.
    expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, salt: ' ' + good.salt }), encodePin('1234')))).toBe('corrupt')
    expect(codeOf(() => unwrapDek(JSON.stringify({ ...good, iv: good.iv + '!!' }), encodePin('1234')))).toBe('corrupt')
  })

  it('refuses KDF parameters outside the allowlist before deriving', SLOW, () => {
    const good = wrapDek(nodeCrypto.randomBytes(32), encodePin('1234'), 'scrypt')
    const withParams = (params: unknown): string => JSON.stringify({ ...good, params })
    // A hostile N would be a memory-exhaustion lever, so it is refused, not derived.
    const started = Date.now()
    expect(codeOf(() => unwrapDek(withParams({ N: 1073741824, r: 8, p: 1, maxmem: 201326592 }), encodePin('1234')))).toBe('corrupt')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(codeOf(() => unwrapDek(withParams({ N: 131072.5, r: 8, p: 1, maxmem: 201326592 }), encodePin('1234')))).toBe('corrupt')
    expect(codeOf(() => unwrapDek(withParams({ N: 131072, r: 99, p: 1, maxmem: 201326592 }), encodePin('1234')))).toBe('corrupt')
    expect(codeOf(() => unwrapDek(withParams(null), encodePin('1234')))).toBe('corrupt')
    // The documented fallback cost stays acceptable.
    expect(codeOf(() => unwrapDek(withParams({ N: 65536, r: 8, p: 1, maxmem: 201326592 }), encodePin('1234')))).toBe('wrong-pin')
  })

  it('dispatches on the recorded kdf and refuses an unknown one without touching it', () => {
    const stored = JSON.stringify({
      v: 1,
      kdf: 'blake3-kdf',
      params: { rounds: 9 },
      salt: nodeCrypto.randomBytes(16).toString('base64'),
      iv: nodeCrypto.randomBytes(12).toString('base64'),
      ct: nodeCrypto.randomBytes(32).toString('base64'),
      tag: nodeCrypto.randomBytes(16).toString('base64'),
    })
    const before = stored
    expect(codeOf(() => unwrapDek(stored, encodePin('1234')))).toBe('unsupported-kdf')
    expect(stored).toBe(before)
  })

  it('produces a different salt on every wrap', SLOW, () => {
    const dek = nodeCrypto.randomBytes(32)
    const a = wrapDek(dek, encodePin('1234'), 'scrypt')
    const b = wrapDek(dek, encodePin('1234'), 'scrypt')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })

  it('bestKdf prefers argon2id only when the runtime can actually derive with it', () => {
    expect(bestKdf()).toBe(hasArgon2 ? 'argon2id' : 'scrypt')
  })

  it('never selects argon2id on the strength of the function existing alone', () => {
    // The guard that matters: a present-but-broken argon2Sync must fall back.
    if (argon2FunctionExists && !argon2Available()) expect(bestKdf()).toBe('scrypt')
    expect(['scrypt', 'argon2id']).toContain(bestKdf())
  })

  it('deriveKey returns 32 bytes and rejects an unknown algorithm', SLOW, () => {
    const salt = nodeCrypto.randomBytes(16)
    expect(deriveKey(encodePin('1234'), salt, 'scrypt', SCRYPT_PARAMS)).toHaveLength(32)
    expect(codeOf(() => deriveKey(encodePin('1234'), salt, 'pbkdf2', {}))).toBe('unsupported-kdf')
  })
})

describe('row envelope', () => {
  const dek = nodeCrypto.randomBytes(32)

  it('round-trips a body', () => {
    const stored = encryptRow(dek, 'abc1234', 'sk-live-secret')
    const parsed = JSON.parse(stored) as { v: number; iv: string; ct: string; tag: string }
    expect(parsed.v).toBe(1)
    expect(Buffer.from(parsed.iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(parsed.tag, 'base64')).toHaveLength(16)
    expect(stored).not.toContain('sk-live-secret')
    expect(decryptRow(dek, 'abc1234', stored)).toBe('sk-live-secret')
  })

  it('uses a fresh IV for every encryption of the same text', () => {
    const a = JSON.parse(encryptRow(dek, 'abc1234', 'same')) as { iv: string; ct: string }
    const b = JSON.parse(encryptRow(dek, 'abc1234', 'same')) as { iv: string; ct: string }
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })

  it('binds the ciphertext to its row: a moved envelope fails to decrypt', () => {
    const stored = encryptRow(dek, 'abc1234', 'sk-live-secret')
    expect(codeOf(() => decryptRow(dek, 'zzz9999', stored))).toBe('corrupt')
  })

  it('matches short_id case-insensitively', () => {
    const stored = encryptRow(dek, 'ABC1234', 'sk-live-secret')
    expect(decryptRow(dek, 'abc1234', stored)).toBe('sk-live-secret')
  })

  it('reports a flipped byte in ct or tag as corrupt, never wrong-pin', () => {
    const parsed = JSON.parse(encryptRow(dek, 'abc1234', 'sk-live-secret')) as {
      v: 1
      iv: string
      ct: string
      tag: string
    }
    const flip = (b64: string): string => {
      const buf = Buffer.from(b64, 'base64')
      buf[0] ^= 0x01
      return buf.toString('base64')
    }
    expect(codeOf(() => decryptRow(dek, 'abc1234', JSON.stringify({ ...parsed, ct: flip(parsed.ct) })))).toBe('corrupt')
    expect(codeOf(() => decryptRow(dek, 'abc1234', JSON.stringify({ ...parsed, tag: flip(parsed.tag) })))).toBe(
      'corrupt'
    )
    expect(codeOf(() => decryptRow(dek, 'abc1234', 'not json'))).toBe('corrupt')
  })

  it('reports a wrong DEK as corrupt', () => {
    const stored = encryptRow(dek, 'abc1234', 'sk-live-secret')
    expect(codeOf(() => decryptRow(nodeCrypto.randomBytes(32), 'abc1234', stored))).toBe('corrupt')
  })

  it('round-trips an empty body and multi-byte text', () => {
    expect(decryptRow(dek, 'abc1234', encryptRow(dek, 'abc1234', ''))).toBe('')
    expect(decryptRow(dek, 'abc1234', encryptRow(dek, 'abc1234', 'パスワード 🔐'))).toBe('パスワード 🔐')
  })
})
