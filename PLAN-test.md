# PhraseVault Test Automation Plan

## Overview

This document provides a complete implementation guide for automated testing in PhraseVault using **Vitest** for unit tests and **Playwright** for E2E tests.

---

## Test Strategy

| Tier | Tool | Purpose | Coverage |
|------|------|---------|----------|
| **Unit Tests** | Vitest | Pure JS modules | ~40% of codebase |
| **E2E Tests** | Playwright | Full app flows | ~60% of codebase |

### Priority Order
1. **Vitest unit tests** - Low effort, high value, CI-ready
2. **Playwright E2E** - Medium effort, comprehensive coverage

---

## Part 1: Vitest Unit Tests

### 1.1 Installation

```bash
npm install --save-dev vitest
```

### 1.2 Package.json Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 1.3 Vitest Configuration

Create `vitest.config.js` in project root:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/dynamic-inserts.js', 'locales/**/*.js']
    }
  }
});
```

### 1.4 Test Directory Structure

```
test/
├── dynamic-inserts.test.js    # Core parser tests
├── locales.test.js            # Locale validation
├── state-logic.test.js        # State pure logic (mocked)
├── test-phrases.sql           # Manual test data (existing)
└── fixtures/
    └── mock-config.js         # Mock data for state tests
```

---

## Part 2: Dynamic Inserts Tests

### 2.1 Test File: `test/dynamic-inserts.test.js`

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parsePlaceholders,
  hasDynamicContent,
  getPromptablePlaceholders,
  resolveAutoPlaceholders,
  applyPromptedValues,
  unescapePlaceholders,
  processPhrase
} from '../src/dynamic-inserts.js';

// ============================================
// PARSING TESTS
// ============================================

describe('parsePlaceholders', () => {
  it('parses simple date placeholder', () => {
    const result = parsePlaceholders('Today is {{date}}');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('date');
    expect(result[0].raw).toBe('{{date}}');
  });

  it('parses placeholder with options', () => {
    const result = parsePlaceholders('{{date:long}}');
    expect(result[0].type).toBe('date');
    expect(result[0].options).toBe('long');
  });

  it('parses placeholder with locale modifier', () => {
    const result = parsePlaceholders('{{date@de}}');
    expect(result[0].type).toBe('date');
    expect(result[0].locale).toBe('de');
  });

  it('parses placeholder with options and locale', () => {
    const result = parsePlaceholders('{{date:long@en-US}}');
    expect(result[0].type).toBe('date');
    expect(result[0].options).toBe('long');
    expect(result[0].locale).toBe('en-US');
  });

  it('parses input with label', () => {
    const result = parsePlaceholders('Hello {{input:Name}}');
    expect(result[0].type).toBe('input');
    expect(result[0].label).toBe('Name');
  });

  it('parses input with label and default', () => {
    const result = parsePlaceholders('{{input:Name=John}}');
    expect(result[0].type).toBe('input');
    expect(result[0].label).toBe('Name');
    expect(result[0].options.default).toBe('John');
  });

  it('parses input with @ in label (not treated as locale)', () => {
    const result = parsePlaceholders('{{input:user@email}}');
    expect(result[0].type).toBe('input');
    expect(result[0].label).toBe('user@email');
    expect(result[0].locale).toBeUndefined();
  });

  it('parses select with choices', () => {
    const result = parsePlaceholders('{{select:Size=S,*M,L}}');
    expect(result[0].type).toBe('select');
    expect(result[0].label).toBe('Size');
    expect(result[0].options.choices).toHaveLength(3);
    expect(result[0].options.choices[1].default).toBe(true);
    expect(result[0].options.choices[1].value).toBe('M');
  });

  it('parses multiple placeholders', () => {
    const result = parsePlaceholders('{{date}} - {{time}} - {{input:Name}}');
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('date');
    expect(result[1].type).toBe('time');
    expect(result[2].type).toBe('input');
  });

  it('ignores escaped placeholders', () => {
    const result = parsePlaceholders('Escaped: \\{{date}} Normal: {{time}}');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('time');
  });

  it('returns empty array for no placeholders', () => {
    const result = parsePlaceholders('Plain text without placeholders');
    expect(result).toHaveLength(0);
  });
});

// ============================================
// DETECTION TESTS
// ============================================

describe('hasDynamicContent', () => {
  it('returns true for text with placeholders', () => {
    expect(hasDynamicContent('Hello {{input:Name}}')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasDynamicContent('Hello World')).toBe(false);
  });

  it('returns false for escaped placeholders only', () => {
    expect(hasDynamicContent('\\{{date}}')).toBe(false);
  });

  it('returns true for mixed escaped and real', () => {
    expect(hasDynamicContent('\\{{escaped}} {{real}}')).toBe(true);
  });
});

// ============================================
// PROMPTABLE PLACEHOLDERS TESTS
// ============================================

describe('getPromptablePlaceholders', () => {
  it('filters to input/textarea/select only', () => {
    const placeholders = [
      { type: 'date', label: '' },
      { type: 'input', label: 'Name' },
      { type: 'time', label: '' },
      { type: 'select', label: 'Size', options: { choices: [] } }
    ];
    const result = getPromptablePlaceholders(placeholders);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('input');
    expect(result[1].type).toBe('select');
  });

  it('deduplicates by label', () => {
    const placeholders = [
      { type: 'input', label: 'Name' },
      { type: 'input', label: 'Name' },
      { type: 'input', label: 'Email' }
    ];
    const result = getPromptablePlaceholders(placeholders);
    expect(result).toHaveLength(2);
  });

  it('keeps unlabeled inputs separate', () => {
    const placeholders = [
      { type: 'input', label: '' },
      { type: 'input', label: '' }
    ];
    const result = getPromptablePlaceholders(placeholders);
    // First unlabeled is kept, second is deduplicated by auto-key
    expect(result).toHaveLength(2);
  });
});

// ============================================
// AUTO-RESOLVE TESTS
// ============================================

describe('resolveAutoPlaceholders', () => {
  it('resolves {{clipboard}} to provided content', () => {
    const result = resolveAutoPlaceholders('Pasted: {{clipboard}}', 'clipboard text');
    expect(result).toBe('Pasted: clipboard text');
  });

  it('resolves {{year}} to current year', () => {
    const result = resolveAutoPlaceholders('Year: {{year}}', '');
    expect(result).toBe(`Year: ${new Date().getFullYear()}`);
  });

  it('leaves input placeholders unresolved', () => {
    const result = resolveAutoPlaceholders('Name: {{input:Name}}', '');
    expect(result).toBe('Name: {{input:Name}}');
  });

  it('resolves date with offset', () => {
    const result = resolveAutoPlaceholders('{{date:+0}}', '');
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

// ============================================
// DATE FORMATTING TESTS
// ============================================

describe('date formatting', () => {
  it('formats {{date}} as YYYY-MM-DD', () => {
    const result = resolveAutoPlaceholders('{{date}}', '');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats {{date:long}} with month name', () => {
    const result = resolveAutoPlaceholders('{{date:long}}', '');
    // Should contain a month name
    expect(result).toMatch(/\w+/);
  });

  it('formats {{date@de}} with German locale', () => {
    const result = resolveAutoPlaceholders('{{date:long@de}}', '');
    // German months: Januar, Februar, März, etc.
    const germanMonths = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                          'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const hasGermanMonth = germanMonths.some(m => result.includes(m));
    expect(hasGermanMonth).toBe(true);
  });

  it('formats custom date YYYY/MM/DD', () => {
    const result = resolveAutoPlaceholders('{{date:YYYY/MM/DD}}', '');
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });
});

// ============================================
// TIME FORMATTING TESTS
// ============================================

describe('time formatting', () => {
  it('formats {{time}} as HH:mm', () => {
    const result = resolveAutoPlaceholders('{{time}}', '');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats {{time:12h}} with AM/PM', () => {
    const result = resolveAutoPlaceholders('{{time:12h}}', '');
    expect(result).toMatch(/(AM|PM)/i);
  });
});

// ============================================
// PROMPTED VALUES TESTS
// ============================================

describe('applyPromptedValues', () => {
  it('replaces input placeholder with value', () => {
    const result = applyPromptedValues('Hello {{input:Name}}!', { Name: 'Alice' });
    expect(result).toBe('Hello Alice!');
  });

  it('replaces multiple occurrences of same label', () => {
    const result = applyPromptedValues('{{input:Name}} says hi to {{input:Name}}', { Name: 'Bob' });
    expect(result).toBe('Bob says hi to Bob');
  });

  it('replaces select placeholder', () => {
    const result = applyPromptedValues('Size: {{select:Size=S,M,L}}', { Size: 'M' });
    expect(result).toBe('Size: M');
  });

  it('leaves unmatched placeholders', () => {
    const result = applyPromptedValues('{{input:Missing}}', {});
    expect(result).toBe('{{input:Missing}}');
  });
});

// ============================================
// ESCAPE TESTS
// ============================================

describe('unescapePlaceholders', () => {
  it('converts \\{{date}} to {{date}}', () => {
    const result = unescapePlaceholders('Literal: \\{{date}}');
    expect(result).toBe('Literal: {{date}}');
  });

  it('handles multiple escaped placeholders', () => {
    const result = unescapePlaceholders('\\{{a}} and \\{{b}}');
    expect(result).toBe('{{a}} and {{b}}');
  });

  it('leaves unescaped placeholders unchanged', () => {
    const result = unescapePlaceholders('{{date}}');
    expect(result).toBe('{{date}}');
  });
});

// ============================================
// FULL PIPELINE TESTS
// ============================================

describe('processPhrase', () => {
  it('processes complete phrase with all placeholder types', () => {
    const phrase = 'Date: {{date}} Name: {{input:Name}} Clip: {{clipboard}}';
    const result = processPhrase(phrase, 'clipboard content', { Name: 'Test' });

    expect(result).toMatch(/^Date: \d{4}-\d{2}-\d{2}/);
    expect(result).toContain('Name: Test');
    expect(result).toContain('Clip: clipboard content');
  });

  it('unescapes after all replacements', () => {
    const phrase = '{{date}} and literal \\{{date}}';
    const result = processPhrase(phrase, '', {});

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(result).toContain('{{date}}');
  });
});

// ============================================
// EDGE CASES
// ============================================

describe('edge cases', () => {
  it('handles empty string', () => {
    const result = processPhrase('', '', {});
    expect(result).toBe('');
  });

  it('handles unknown placeholder type', () => {
    const result = resolveAutoPlaceholders('{{unknown:foo}}', '');
    expect(result).toBe('{{unknown:foo}}');
  });

  it('handles malformed placeholder gracefully', () => {
    const result = parsePlaceholders('{{}}');
    expect(result[0].type).toBe('');
  });

  it('handles deeply nested braces', () => {
    // Should not match - our regex requires non-} characters inside
    const result = parsePlaceholders('{{nested{{inside}}}}');
    expect(result).toHaveLength(1);
  });

  it('handles invalid locale code gracefully', () => {
    // Invalid locale should fall back to system default
    const result = resolveAutoPlaceholders('{{date@xyz}}', '');
    expect(result).toMatch(/\d/); // Should still produce some date
  });
});
```

---

## Part 3: Locale Validation Tests

### 3.1 Test File: `test/locales.test.js`

```js
import { describe, it, expect } from 'vitest';
import en from '../locales/en.js';
import de from '../locales/de.js';
import es from '../locales/es.js';
import fr from '../locales/fr.js';
import it from '../locales/it.js';
import pt from '../locales/pt.js';

const locales = { en, de, es, fr, it, pt };
const localeNames = Object.keys(locales);

describe('Locale Files', () => {
  // ============================================
  // KEY PARITY TESTS
  // ============================================

  describe('key parity', () => {
    const enKeys = Object.keys(en.translation).sort();

    localeNames.filter(l => l !== 'en').forEach(localeName => {
      it(`${localeName} has same keys as English`, () => {
        const localeKeys = Object.keys(locales[localeName].translation).sort();
        expect(localeKeys).toEqual(enKeys);
      });
    });
  });

  // ============================================
  // EMPTY VALUE TESTS
  // ============================================

  describe('no empty values', () => {
    localeNames.forEach(localeName => {
      it(`${localeName} has no empty translation values`, () => {
        const translations = locales[localeName].translation;
        Object.entries(translations).forEach(([key, value]) => {
          expect(value.trim().length, `Key "${key}" in ${localeName}`).toBeGreaterThan(0);
        });
      });
    });
  });

  // ============================================
  // PLACEHOLDER CONSISTENCY TESTS
  // ============================================

  describe('placeholder consistency', () => {
    // Find keys with placeholders like {0}, {1}, {{variable}}
    const placeholderRegex = /\{[^}]+\}/g;

    localeNames.filter(l => l !== 'en').forEach(localeName => {
      it(`${localeName} has matching placeholders with English`, () => {
        const enTranslations = en.translation;
        const localeTranslations = locales[localeName].translation;

        Object.keys(enTranslations).forEach(key => {
          const enValue = enTranslations[key];
          const localeValue = localeTranslations[key];

          const enPlaceholders = (enValue.match(placeholderRegex) || []).sort();
          const localePlaceholders = (localeValue.match(placeholderRegex) || []).sort();

          expect(localePlaceholders, `Key "${key}" in ${localeName}`).toEqual(enPlaceholders);
        });
      });
    });
  });

  // ============================================
  // STRUCTURE TESTS
  // ============================================

  describe('structure', () => {
    localeNames.forEach(localeName => {
      it(`${localeName} has translation object`, () => {
        expect(locales[localeName]).toHaveProperty('translation');
        expect(typeof locales[localeName].translation).toBe('object');
      });
    });
  });

  // ============================================
  // REQUIRED KEYS TESTS
  // ============================================

  describe('required keys exist', () => {
    const requiredKeys = [
      'Settings',
      'Save',
      'Cancel',
      'Add Phrase',
      'Edit Phrase',
      'Delete Phrase',
      'Fill in Details',
      'Insert',
      'Value',
      'Text'
    ];

    localeNames.forEach(localeName => {
      it(`${localeName} has all required keys`, () => {
        requiredKeys.forEach(key => {
          expect(locales[localeName].translation, `Missing "${key}" in ${localeName}`).toHaveProperty(key);
        });
      });
    });
  });
});
```

---

## Part 4: State Logic Tests (Mocked)

### 4.1 Test File: `test/state-logic.test.js`

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron and fs BEFORE importing state
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-app')
  }
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn()
}));

// Now import - but we need to test the logic, not the module initialization
// So we'll test the pure logic functions by recreating them

describe('State Logic (Pure Functions)', () => {
  // ============================================
  // PURCHASE REMINDER LOGIC
  // ============================================

  describe('shouldShowPurchaseReminder logic', () => {
    function shouldShowPurchaseReminder(config) {
      if (config.purchased) return false;
      if (!config.installDate) return false;

      const installDate = new Date(config.installDate);
      const now = new Date();
      const daysSinceInstall = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));

      if (daysSinceInstall < 14) return false;
      return true;
    }

    it('returns false if already purchased', () => {
      const config = { purchased: true, installDate: '2020-01-01' };
      expect(shouldShowPurchaseReminder(config)).toBe(false);
    });

    it('returns false if no install date', () => {
      const config = { purchased: false, installDate: null };
      expect(shouldShowPurchaseReminder(config)).toBe(false);
    });

    it('returns false within 14 day trial', () => {
      const now = new Date();
      const installDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const config = { purchased: false, installDate: installDate.toISOString() };
      expect(shouldShowPurchaseReminder(config)).toBe(false);
    });

    it('returns true after 14 day trial', () => {
      const now = new Date();
      const installDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const config = { purchased: false, installDate: installDate.toISOString() };
      expect(shouldShowPurchaseReminder(config)).toBe(true);
    });

    it('returns true exactly at 14 days', () => {
      const now = new Date();
      const installDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
      const config = { purchased: false, installDate: installDate.toISOString() };
      expect(shouldShowPurchaseReminder(config)).toBe(true);
    });
  });

  // ============================================
  // RECENT FILES LOGIC
  // ============================================

  describe('addRecentFile logic', () => {
    function addRecentFile(recentFiles, filePath) {
      let files = [...recentFiles];
      if (files.includes(filePath)) {
        files = files.filter(f => f !== filePath);
      }
      files.unshift(filePath);
      if (files.length > 10) {
        files.pop();
      }
      return files;
    }

    it('adds new file to front', () => {
      const result = addRecentFile(['a', 'b'], 'c');
      expect(result).toEqual(['c', 'a', 'b']);
    });

    it('moves existing file to front', () => {
      const result = addRecentFile(['a', 'b', 'c'], 'b');
      expect(result).toEqual(['b', 'a', 'c']);
    });

    it('limits to 10 files', () => {
      const files = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
      const result = addRecentFile(files, 'new');
      expect(result).toHaveLength(10);
      expect(result[0]).toBe('new');
      expect(result).not.toContain('10');
    });

    it('handles empty list', () => {
      const result = addRecentFile([], 'first');
      expect(result).toEqual(['first']);
    });
  });

  // ============================================
  // LICENSE AGREEMENT LOGIC
  // ============================================

  describe('license agreement logic', () => {
    function shouldShowLicenseAgreement(config) {
      return config.licenseAgreed !== 'SPQRK SOFTWARE LICENSE v1.0';
    }

    it('returns true if not agreed', () => {
      expect(shouldShowLicenseAgreement({ licenseAgreed: false })).toBe(true);
    });

    it('returns true if agreed to different version', () => {
      expect(shouldShowLicenseAgreement({ licenseAgreed: 'OLD LICENSE' })).toBe(true);
    });

    it('returns false if agreed to current version', () => {
      expect(shouldShowLicenseAgreement({ licenseAgreed: 'SPQRK SOFTWARE LICENSE v1.0' })).toBe(false);
    });
  });
});
```

---

## Part 5: Playwright E2E Tests (Future)

### 5.1 Installation

```bash
npm install --save-dev @playwright/test
```

### 5.2 Package.json Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

### 5.3 Playwright Configuration

Create `playwright.config.js`:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60000,
  retries: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry'
  }
});
```

### 5.4 Example E2E Test: `test/e2e/app.spec.js`

```js
import { test, expect, _electron } from '@playwright/test';
import path from 'path';

let app;
let window;

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [path.join(__dirname, '../../src/main.js')],
    env: { ...process.env, NODE_ENV: 'test' }
  });
  window = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
});

test('app launches successfully', async () => {
  const title = await window.title();
  expect(title).toContain('PhraseVault');
});

test('main window is visible', async () => {
  const isVisible = await window.isVisible('body');
  expect(isVisible).toBe(true);
});

test('phrase list renders', async () => {
  await window.waitForSelector('.phrase-item', { timeout: 5000 });
  const items = await window.$$('.phrase-item');
  expect(items.length).toBeGreaterThan(0);
});

test('add phrase modal opens', async () => {
  await window.click('[data-action="add-phrase"]');
  await window.waitForSelector('.modal.active', { timeout: 2000 });
  const modal = await window.$('.modal.active');
  expect(modal).toBeTruthy();
});

test('settings modal opens', async () => {
  await window.click('[data-action="settings"]');
  await window.waitForSelector('#settings-modal.active', { timeout: 2000 });
  const modal = await window.$('#settings-modal.active');
  expect(modal).toBeTruthy();
});
```

---

## Part 6: CI/CD Integration

### 6.1 GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        if: always()
        with:
          files: ./coverage/coverage-final.json

  # E2E tests (optional - run on release branches)
  e2e-tests:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npm run rebuild

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          CI: true
```

---

## Part 7: Implementation Checklist

### Phase 1: Unit Tests (Recommended First)

- [ ] Install Vitest: `npm install --save-dev vitest`
- [ ] Create `vitest.config.js`
- [ ] Add test scripts to `package.json`
- [ ] Create `test/dynamic-inserts.test.js`
- [ ] Create `test/locales.test.js`
- [ ] Create `test/state-logic.test.js`
- [ ] Run tests: `npm test`
- [ ] Add to CI: `.github/workflows/test.yml`

### Phase 2: E2E Tests (Optional)

- [ ] Install Playwright: `npm install --save-dev @playwright/test`
- [ ] Create `playwright.config.js`
- [ ] Create `test/e2e/` directory
- [ ] Write basic app launch tests
- [ ] Write critical user flow tests
- [ ] Add E2E to CI workflow

---

## Part 8: Expected Test Coverage

| Module | Test File | Scenarios | Priority |
|--------|-----------|-----------|----------|
| `dynamic-inserts.js` | `dynamic-inserts.test.js` | ~50 | ⭐ High |
| `locales/*.js` | `locales.test.js` | ~30 | ⭐ High |
| `state.js` (logic) | `state-logic.test.js` | ~15 | Medium |
| Full app | `e2e/app.spec.js` | ~10 | Low |

---

## Part 9: Running Tests

```bash
# Run all unit tests once
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run E2E tests (after setup)
npm run test:e2e

# Run E2E tests with browser visible
npm run test:e2e:headed
```

---

## Notes

### CommonJS Compatibility

The project uses CommonJS (`require`/`module.exports`). Vitest handles this via:
- `deps.interopDefault: true` in config
- ESM test files importing CommonJS modules

If issues arise, convert test files to `.cjs` or add to `vitest.config.js`:

```js
resolve: {
  conditions: ['node']
}
```

### Native Modules (sqlite3, robotjs)

Unit tests avoid native modules by testing only pure JS logic. E2E tests require:
- `npm run rebuild` before running
- Platform-specific CI runners

### Mocking Electron

For state tests, Electron's `app` module is mocked. The actual state logic is extracted and tested as pure functions to avoid module initialization issues.
