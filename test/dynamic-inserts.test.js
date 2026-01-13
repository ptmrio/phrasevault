import { describe, it, expect } from 'vitest';
import {
  parsePlaceholders,
  hasDynamicContent,
  getPromptablePlaceholders,
  resolveAutoPlaceholders,
  applyPromptedValues,
  unescapePlaceholders,
  processPhrase,
  hasCrossInserts,
  extractPhraseRefs,
  resolveCrossInserts
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

  it('parses textarea placeholder', () => {
    const result = parsePlaceholders('{{textarea:Notes}}');
    expect(result[0].type).toBe('textarea');
    expect(result[0].label).toBe('Notes');
  });

  it('parses clipboard placeholder', () => {
    const result = parsePlaceholders('{{clipboard}}');
    expect(result[0].type).toBe('clipboard');
  });

  it('parses time placeholder', () => {
    const result = parsePlaceholders('{{time}}');
    expect(result[0].type).toBe('time');
  });

  it('parses datetime placeholder', () => {
    const result = parsePlaceholders('{{datetime}}');
    expect(result[0].type).toBe('datetime');
  });

  it('parses weekday placeholder', () => {
    const result = parsePlaceholders('{{weekday}}');
    expect(result[0].type).toBe('weekday');
  });

  it('parses month placeholder', () => {
    const result = parsePlaceholders('{{month}}');
    expect(result[0].type).toBe('month');
  });

  it('parses year placeholder', () => {
    const result = parsePlaceholders('{{year}}');
    expect(result[0].type).toBe('year');
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

  it('keeps unlabeled inputs as single entry', () => {
    const placeholders = [
      { type: 'input', label: '' },
      { type: 'input', label: '' }
    ];
    const result = getPromptablePlaceholders(placeholders);
    // Unlabeled get auto-key, so second one is deduplicated
    expect(result.length).toBeGreaterThanOrEqual(1);
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

  it('leaves select placeholders unresolved', () => {
    const result = resolveAutoPlaceholders('{{select:Size=S,M,L}}', '');
    expect(result).toBe('{{select:Size=S,M,L}}');
  });

  it('leaves textarea placeholders unresolved', () => {
    const result = resolveAutoPlaceholders('{{textarea:Notes}}', '');
    expect(result).toBe('{{textarea:Notes}}');
  });

  it('resolves empty clipboard gracefully', () => {
    const result = resolveAutoPlaceholders('Clip: {{clipboard}}', '');
    expect(result).toBe('Clip: ');
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

  it('formats {{date:long}} with words', () => {
    const result = resolveAutoPlaceholders('{{date:long}}', '');
    // Should contain letters (month name)
    expect(result).toMatch(/[a-zA-Z]/);
  });

  it('formats {{date:short}} as localized date', () => {
    const result = resolveAutoPlaceholders('{{date:short}}', '');
    expect(result.length).toBeGreaterThan(0);
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

  it('formats date with offset +7', () => {
    const result = resolveAutoPlaceholders('{{date:+7}}', '');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats date with offset -1', () => {
    const result = resolveAutoPlaceholders('{{date:-1}}', '');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats weekday', () => {
    const result = resolveAutoPlaceholders('{{weekday}}', '');
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    expect(weekdays).toContain(result);
  });

  it('formats month', () => {
    const result = resolveAutoPlaceholders('{{month}}', '');
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    expect(months).toContain(result);
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

  it('formats {{datetime}}', () => {
    const result = resolveAutoPlaceholders('{{datetime}}', '');
    expect(result).toMatch(/\d/);
    expect(result).toContain(' ');
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

  it('replaces textarea placeholder', () => {
    const result = applyPromptedValues('Notes: {{textarea:Notes}}', { Notes: 'My notes here' });
    expect(result).toBe('Notes: My notes here');
  });

  it('leaves unmatched placeholders', () => {
    const result = applyPromptedValues('{{input:Missing}}', {});
    expect(result).toBe('{{input:Missing}}');
  });

  it('handles empty value', () => {
    const result = applyPromptedValues('{{input:Name}}', { Name: '' });
    expect(result).toBe('');
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

  it('handles mixed escaped and unescaped', () => {
    const result = unescapePlaceholders('\\{{literal}} and {{real}}');
    expect(result).toBe('{{literal}} and {{real}}');
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

  it('handles phrase with only auto placeholders', () => {
    const phrase = '{{date}} {{time}} {{year}}';
    const result = processPhrase(phrase, '', {});
    expect(result).not.toContain('{{');
  });

  it('handles phrase with only prompted placeholders', () => {
    const phrase = '{{input:Name}} {{select:Size=S,M,L}}';
    const result = processPhrase(phrase, '', { Name: 'John', Size: 'M' });
    expect(result).toBe('John M');
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

  it('handles placeholder at start of string', () => {
    const result = resolveAutoPlaceholders('{{year}} is the year', '');
    expect(result).toMatch(/^\d{4} is the year$/);
  });

  it('handles placeholder at end of string', () => {
    const result = resolveAutoPlaceholders('The year is {{year}}', '');
    expect(result).toMatch(/^The year is \d{4}$/);
  });

  it('handles adjacent placeholders', () => {
    const result = resolveAutoPlaceholders('{{year}}{{year}}', '');
    const year = new Date().getFullYear();
    expect(result).toBe(`${year}${year}`);
  });

  it('handles invalid locale code gracefully', () => {
    // Invalid locale should fall back to system default
    const result = resolveAutoPlaceholders('{{date@xyz}}', '');
    expect(result).toMatch(/\d/); // Should still produce some date
  });

  it('handles special characters in input value', () => {
    const result = applyPromptedValues('{{input:Name}}', { Name: '<script>alert("xss")</script>' });
    expect(result).toBe('<script>alert("xss")</script>');
  });

  it('handles newlines in textarea value', () => {
    const result = applyPromptedValues('{{textarea:Notes}}', { Notes: 'Line 1\nLine 2' });
    expect(result).toBe('Line 1\nLine 2');
  });
});

// ============================================
// PIPE SEPARATOR (OFFSET|FORMAT) TESTS
// ============================================

import { parseDateOptions, formatDate, formatDateTime, formatTime } from '../src/dynamic-inserts.js';

describe('parseDateOptions', () => {
  it('returns nulls for empty options', () => {
    const result = parseDateOptions(null);
    expect(result).toEqual({ offset: null, format: null });
  });

  it('returns nulls for undefined options', () => {
    const result = parseDateOptions(undefined);
    expect(result).toEqual({ offset: null, format: null });
  });

  it('parses positive offset only', () => {
    const result = parseDateOptions('+7');
    expect(result).toEqual({ offset: 7, format: null });
  });

  it('parses negative offset only', () => {
    const result = parseDateOptions('-3');
    expect(result).toEqual({ offset: -3, format: null });
  });

  it('parses zero offset', () => {
    const result = parseDateOptions('0');
    expect(result).toEqual({ offset: 0, format: null });
  });

  it('parses format only (short)', () => {
    const result = parseDateOptions('short');
    expect(result).toEqual({ offset: null, format: 'short' });
  });

  it('parses format only (long)', () => {
    const result = parseDateOptions('long');
    expect(result).toEqual({ offset: null, format: 'long' });
  });

  it('parses custom format only', () => {
    const result = parseDateOptions('DD/MM/YYYY');
    expect(result).toEqual({ offset: null, format: 'DD/MM/YYYY' });
  });

  it('parses offset|format with positive offset', () => {
    const result = parseDateOptions('+7|long');
    expect(result).toEqual({ offset: 7, format: 'long' });
  });

  it('parses offset|format with negative offset', () => {
    const result = parseDateOptions('-7|long');
    expect(result).toEqual({ offset: -7, format: 'long' });
  });

  it('parses offset|format with zero offset', () => {
    const result = parseDateOptions('0|short');
    expect(result).toEqual({ offset: 0, format: 'short' });
  });

  it('parses offset|format with custom format containing slashes', () => {
    const result = parseDateOptions('-7|DD/MM/YYYY');
    expect(result).toEqual({ offset: -7, format: 'DD/MM/YYYY' });
  });

  it('parses offset|format with custom format containing dashes', () => {
    const result = parseDateOptions('+30|YYYY-MM-DD');
    expect(result).toEqual({ offset: 30, format: 'YYYY-MM-DD' });
  });

  it('handles whitespace around pipe', () => {
    const result = parseDateOptions('-7 | long');
    expect(result).toEqual({ offset: -7, format: 'long' });
  });

  it('handles empty format after pipe', () => {
    const result = parseDateOptions('-7|');
    expect(result).toEqual({ offset: -7, format: null });
  });

  it('handles format with no offset before pipe (invalid, treated as format)', () => {
    const result = parseDateOptions('|long');
    expect(result.format).toBe('long');
  });
});

describe('date offset|format combinations', () => {
  it('formats {{date:-7|long}} correctly', () => {
    const result = resolveAutoPlaceholders('{{date:-7|long}}', '');
    // Should contain letters (month name) from long format
    expect(result).toMatch(/[a-zA-Z]/);
  });

  it('formats {{date:+7|short}} correctly', () => {
    const result = resolveAutoPlaceholders('{{date:+7|short}}', '');
    expect(result).toMatch(/\d/);
  });

  it('formats {{date:-1|DD/MM/YYYY}} with custom format', () => {
    const result = resolveAutoPlaceholders('{{date:-1|DD/MM/YYYY}}', '');
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('formats {{date:+30|YYYY-MM-DD}} with custom format', () => {
    const result = resolveAutoPlaceholders('{{date:+30|YYYY-MM-DD}}', '');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats {{date:0|long}} for today in long format', () => {
    const result = resolveAutoPlaceholders('{{date:0|long}}', '');
    expect(result).toMatch(/[a-zA-Z]/);
  });

  it('combines offset|format with locale modifier', () => {
    const result = resolveAutoPlaceholders('{{date:-7|long@de}}', '');
    const germanMonths = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                          'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const hasGermanMonth = germanMonths.some(m => result.includes(m));
    expect(hasGermanMonth).toBe(true);
  });
});

describe('datetime offset|format combinations', () => {
  it('formats {{datetime:-1}} with offset', () => {
    const result = resolveAutoPlaceholders('{{datetime:-1}}', '');
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('formats {{datetime:-1|short}} with offset and format', () => {
    const result = resolveAutoPlaceholders('{{datetime:-1|short}}', '');
    expect(result).toMatch(/\d/);
  });

  it('formats {{datetime:+7|long}} with offset and format', () => {
    const result = resolveAutoPlaceholders('{{datetime:+7|long}}', '');
    expect(result).toMatch(/[a-zA-Z]/);
  });

  it('formats {{datetime@de}} with locale', () => {
    const result = resolveAutoPlaceholders('{{datetime@de}}', '');
    expect(result).toMatch(/\d/);
  });

  it('formats {{datetime:-1|short@de}} with all modifiers', () => {
    const result = resolveAutoPlaceholders('{{datetime:-1|short@de}}', '');
    expect(result).toMatch(/\d/);
  });
});

describe('edge cases for pipe separator', () => {
  it('handles multiple pipes (first one wins)', () => {
    // e.g., "-7|DD|MM|YYYY" - format is "DD|MM|YYYY"
    const result = parseDateOptions('-7|DD|MM|YYYY');
    expect(result.offset).toBe(-7);
    expect(result.format).toBe('DD|MM|YYYY');
  });

  it('handles large positive offset', () => {
    const result = parseDateOptions('+365|long');
    expect(result.offset).toBe(365);
    expect(result.format).toBe('long');
  });

  it('handles large negative offset', () => {
    const result = parseDateOptions('-365|long');
    expect(result.offset).toBe(-365);
    expect(result.format).toBe('long');
  });

  it('correctly applies offset to date', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const result = resolveAutoPlaceholders('{{date:+1}}', '');
    const expectedYear = tomorrow.getFullYear();
    const expectedMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const expectedDay = String(tomorrow.getDate()).padStart(2, '0');
    expect(result).toBe(`${expectedYear}-${expectedMonth}-${expectedDay}`);
  });

  it('correctly applies negative offset to date', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const result = resolveAutoPlaceholders('{{date:-1}}', '');
    const expectedYear = yesterday.getFullYear();
    const expectedMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    const expectedDay = String(yesterday.getDate()).padStart(2, '0');
    expect(result).toBe(`${expectedYear}-${expectedMonth}-${expectedDay}`);
  });

  it('works with US date format MM/DD/YYYY', () => {
    const result = resolveAutoPlaceholders('{{date:0|MM/DD/YYYY}}', '');
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('works with European format DD.MM.YYYY', () => {
    const result = resolveAutoPlaceholders('{{date:0|DD.MM.YYYY}}', '');
    expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});


// ============================================
// CROSS-INSERT (NESTED PHRASES) TESTS
// ============================================

describe("cross-inserts", () => {
  // Mock database lookup function
  const mockGetPhrase = async (shortId) => {
    const phrases = {
      "abc1234": { short_id: "abc1234", expanded_text: "Hello World" },
      "def5678": { short_id: "def5678", expanded_text: "Date: {{date}}" },
      "ghi9012": { short_id: "ghi9012", expanded_text: "Nested: {{phrase:abc1234}}" },
      "jkl3456": { short_id: "jkl3456", expanded_text: "Circular: {{phrase:mno7890}}" },
      "mno7890": { short_id: "mno7890", expanded_text: "Back: {{phrase:jkl3456}}" },
      "deep001": { short_id: "deep001", expanded_text: "Level1: {{phrase:deep002}}" },
      "deep002": { short_id: "deep002", expanded_text: "Level2: {{phrase:deep003}}" },
      "deep003": { short_id: "deep003", expanded_text: "Level3: Done" }
    };
    return phrases[shortId] || null;
  };

  describe("hasCrossInserts", () => {
    it("detects cross-insert syntax", () => {
      expect(hasCrossInserts("{{phrase:abc1234}}")).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(hasCrossInserts("plain text")).toBe(false);
    });

    it("returns false for other placeholder types", () => {
      expect(hasCrossInserts("{{date}} {{input:Name}}")).toBe(false);
    });

    it("detects multiple cross-inserts", () => {
      expect(hasCrossInserts("{{phrase:abc1234}} and {{phrase:def5678}}")).toBe(true);
    });

    it("is case insensitive for short_id", () => {
      expect(hasCrossInserts("{{phrase:ABC1234}}")).toBe(true);
    });

    it("ignores escaped cross-inserts", () => {
      expect(hasCrossInserts("\\{{phrase:abc1234}}")).toBe(false);
    });
  });

  describe("extractPhraseRefs", () => {
    it("extracts single phrase short_id", () => {
      const ids = extractPhraseRefs("{{phrase:abc1234}}");
      expect(ids).toEqual(["abc1234"]);
    });

    it("extracts multiple phrase short_ids", () => {
      const ids = extractPhraseRefs("{{phrase:abc1234}} and {{phrase:def5678}}");
      expect(ids).toEqual(["abc1234", "def5678"]);
    });

    it("returns empty array for no matches", () => {
      const ids = extractPhraseRefs("plain text");
      expect(ids).toEqual([]);
    });

    it("normalizes to lowercase", () => {
      const ids = extractPhraseRefs("{{phrase:ABC1234}}");
      expect(ids).toEqual(["abc1234"]);
    });

    it("only matches 7-character IDs", () => {
      const ids = extractPhraseRefs("{{phrase:abc}} {{phrase:abc1234}} {{phrase:toolongid}}");
      expect(ids).toEqual(["abc1234"]);
    });
  });

  describe("resolveCrossInserts", () => {
    it("resolves simple reference", async () => {
      const result = await resolveCrossInserts("Say: {{phrase:abc1234}}", mockGetPhrase);
      expect(result).toBe("Say: Hello World");
    });

    it("resolves multiple references", async () => {
      const result = await resolveCrossInserts("{{phrase:abc1234}} - {{phrase:abc1234}}", mockGetPhrase);
      expect(result).toBe("Hello World - Hello World");
    });

    it("resolves nested references", async () => {
      const result = await resolveCrossInserts("{{phrase:ghi9012}}", mockGetPhrase);
      expect(result).toBe("Nested: Hello World");
    });

    it("resolves deeply nested references", async () => {
      const result = await resolveCrossInserts("{{phrase:deep001}}", mockGetPhrase);
      expect(result).toBe("Level1: Level2: Level3: Done");
    });

    it("leaves unknown IDs unresolved", async () => {
      const result = await resolveCrossInserts("{{phrase:unknown}}", mockGetPhrase);
      expect(result).toBe("{{phrase:unknown}}");
    });

    it("prevents circular references", async () => {
      const result = await resolveCrossInserts("{{phrase:jkl3456}}", mockGetPhrase);
      // Should stop at circular reference, leaving one unresolved
      expect(result).toContain("{{phrase:");
    });

    it("prevents self-reference with visitedIds", async () => {
      const result = await resolveCrossInserts(
        "Self: {{phrase:abc1234}}", 
        mockGetPhrase, 
        new Set(["abc1234"])
      );
      expect(result).toBe("Self: {{phrase:abc1234}}");
    });

    it("respects maxDepth limit", async () => {
      const result = await resolveCrossInserts(
        "{{phrase:deep001}}", 
        mockGetPhrase, 
        new Set(), 
        2
      );
      // Should stop before reaching Level3
      expect(result).toContain("{{phrase:");
    });

    it("preserves text around references", async () => {
      const result = await resolveCrossInserts(
        "Before {{phrase:abc1234}} After", 
        mockGetPhrase
      );
      expect(result).toBe("Before Hello World After");
    });

    it("handles mixed content with other placeholders", async () => {
      const result = await resolveCrossInserts(
        "{{phrase:def5678}} and more",
        mockGetPhrase
      );
      expect(result).toBe("Date: {{date}} and more");
    });
  });
});
