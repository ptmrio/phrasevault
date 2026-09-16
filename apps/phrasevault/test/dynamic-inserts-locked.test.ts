/**
 * Cross-insert resolution against locked targets. The reveal hook stands in for
 * lock.ts's revealRow, so this file stays free of crypto.
 */
import { describe, expect, it, vi } from 'vitest'
import { redactProtectedPromptPlaceholders, remapProtectedSelectValues, resolveCrossInserts, parsePlaceholders, getPromptablePlaceholders, processPhrase } from '../src/dynamic-inserts'
import type { CrossInsertTarget } from '../src/dynamic-inserts'

function target(over: Partial<CrossInsertTarget> = {}): CrossInsertTarget {
  return { id: 1, short_id: 'abc1234', expanded_text: 'plain', locked: 0, expanded_cipher: null, ...over }
}

const lookup =
  (rows: Record<string, CrossInsertTarget>) =>
  async (shortId: string): Promise<CrossInsertTarget | null> =>
    rows[shortId] ?? null

class FakeVaultError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const revealPlain = (t: CrossInsertTarget): string => t.expanded_text

/** Refuses any locked target, the way revealRow does while the session is locked. */
const revealWhileLocked = (t: CrossInsertTarget): string => {
  if (t.locked === 1) throw new FakeVaultError('locked')
  return t.expanded_text
}

describe('resolveCrossInserts with locked targets', () => {
  it('resolves a locked target through reveal while unlocked', async () => {
    const rows = { abc1234: target({ locked: 1, expanded_text: '', expanded_cipher: 'cipher' }) }
    const reveal = vi.fn(() => 'opened body')
    expect(await resolveCrossInserts('before {{phrase:abc1234}} after', lookup(rows), new Set(), 10, reveal)).toBe(
      'before opened body after'
    )
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('aborts the whole resolution when reveal throws', async () => {
    const rows = { abc1234: target({ locked: 1, expanded_text: '', expanded_cipher: 'cipher' }) }
    await expect(
      resolveCrossInserts('a {{phrase:abc1234}} b', lookup(rows), new Set(), 10, revealWhileLocked)
    ).rejects.toBeInstanceOf(FakeVaultError)
  })

  it('does not return partially resolved text when a later reference is locked', async () => {
    const rows = {
      aaaaaaa: target({ short_id: 'aaaaaaa', expanded_text: 'OPEN' }),
      bbbbbbb: target({ short_id: 'bbbbbbb', locked: 1, expanded_text: '', expanded_cipher: 'c' }),
    }
    await expect(
      resolveCrossInserts('{{phrase:aaaaaaa}} {{phrase:bbbbbbb}}', lookup(rows), new Set(), 10, revealWhileLocked)
    ).rejects.toBeInstanceOf(FakeVaultError)
  })

  it('aborts when a nested target several levels down is locked', async () => {
    const rows = {
      aaaaaaa: target({ short_id: 'aaaaaaa', expanded_text: 'wraps {{phrase:bbbbbbb}}' }),
      bbbbbbb: target({ short_id: 'bbbbbbb', locked: 1, expanded_text: '', expanded_cipher: 'c' }),
    }
    await expect(
      resolveCrossInserts('{{phrase:aaaaaaa}}', lookup(rows), new Set(), 10, revealWhileLocked)
    ).rejects.toBeInstanceOf(FakeVaultError)
  })

  it('propagates a corrupt failure rather than swallowing it', async () => {
    const rows = { abc1234: target({ locked: 1, expanded_text: '', expanded_cipher: 'damaged' }) }
    const reveal = (): string => {
      throw new FakeVaultError('corrupt')
    }
    await expect(
      resolveCrossInserts('{{phrase:abc1234}}', lookup(rows), new Set(), 10, reveal)
    ).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('reports that a protected phrase took part, at any depth', async () => {
    const rows = {
      aaaaaaa: target({ short_id: 'aaaaaaa', expanded_text: 'wraps {{phrase:bbbbbbb}}' }),
      bbbbbbb: target({ short_id: 'bbbbbbb', locked: 1, expanded_text: '', expanded_cipher: 'c' }),
    }
    let sawProtected = false
    // Plain bodies pass through so the nested reference survives to be resolved.
    const reveal = (t: CrossInsertTarget): string => (t.locked === 1 ? 'secret' : t.expanded_text)
    const text = await resolveCrossInserts(
      '{{phrase:aaaaaaa}}',
      lookup(rows),
      new Set(),
      10,
      reveal,
      () => {
        sawProtected = true
      }
    )
    expect(sawProtected).toBe(true)
    expect(text).toContain('secret')
  })

  it('does not report protected for an all-plaintext resolution', async () => {
    const rows = { aaaaaaa: target({ short_id: 'aaaaaaa', expanded_text: 'OPEN' }) }
    let sawProtected = false
    await resolveCrossInserts('{{phrase:aaaaaaa}}', lookup(rows), new Set(), 10, revealPlain, () => {
      sawProtected = true
    })
    expect(sawProtected).toBe(false)
  })

  it('treats dollar sequences in a resolved body as literal text', async () => {
    // $& / $` / $' are replacement patterns; a protected body must not be able
    // to smuggle surrounding text into the result through them.
    const rows = { abc1234: target({ expanded_text: "a$&b$`c$'d$$e" }) }
    expect(await resolveCrossInserts('X {{phrase:abc1234}} Y', lookup(rows), new Set(), 10, revealPlain)).toBe(
      "X a$&b$`c$'d$$e Y"
    )
  })

  it('keeps today behaviour for a missing target', async () => {
    expect(await resolveCrossInserts('x {{phrase:missing}} y', lookup({}))).toBe('x {{phrase:missing}} y')
  })

  it('keeps today behaviour for a circular reference', async () => {
    const rows = { aaaaaaa: target({ short_id: 'aaaaaaa', expanded_text: 'loop {{phrase:aaaaaaa}}' }) }
    const out = await resolveCrossInserts('{{phrase:aaaaaaa}}', lookup(rows), new Set(), 10, revealPlain)
    expect(out).toBe('loop {{phrase:aaaaaaa}}')
  })

  it('keeps today behaviour when the lookup itself fails', async () => {
    const failing = async (): Promise<CrossInsertTarget | null> => {
      throw new Error('database gone')
    }
    expect(await resolveCrossInserts('x {{phrase:abc1234}} y', failing, new Set(), 10, revealPlain)).toBe(
      'x {{phrase:abc1234}} y'
    )
  })

  it('defaults reveal to the plaintext body so existing callers are unchanged', async () => {
    const rows = { abc1234: target({ expanded_text: 'ordinary' }) }
    expect(await resolveCrossInserts('{{phrase:abc1234}}', lookup(rows))).toBe('ordinary')
  })

  it('strips defaults and raw tokens from protected prompt placeholders', () => {
    const parsed = parsePlaceholders('{{input:API key=sk-live-secret}}')
    const promptable = getPromptablePlaceholders(parsed)
    const redacted = redactProtectedPromptPlaceholders(promptable)
    expect(JSON.stringify(redacted)).not.toContain('sk-live-secret')
    expect(redacted[0]?.raw).toBe('{{input}}')
    expect(redacted[0]?.options?.default).toBeUndefined()
  })

  it('strips select option values from protected prompt placeholders', () => {
    const parsed = parsePlaceholders('{{select:Password=secret-a,*secret-b}}')
    const promptable = getPromptablePlaceholders(parsed)
    const redacted = redactProtectedPromptPlaceholders(promptable)
    expect(JSON.stringify(redacted)).not.toContain('secret-a')
    expect(JSON.stringify(redacted)).not.toContain('secret-b')
    expect(redacted[0]?.options?.choices).toEqual([
      { value: '0', default: false },
      { value: '1', default: false },
    ])
    const restored = remapProtectedSelectValues('{{select:Password=secret-a,*secret-b}}', { Password: '1' })
    expect(restored.Password).toBe('secret-b')
    expect(processPhrase('{{select:Password=secret-a,*secret-b}}', '', restored)).toBe('secret-b')
  })
})
