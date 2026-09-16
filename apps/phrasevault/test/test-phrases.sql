-- Test Phrases for PhraseVault Dynamic Inserts (V2 Schema)
-- Requires short_id column - run this SQL first if missing:
--   ALTER TABLE phrases ADD COLUMN short_id TEXT;
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_phrases_short_id ON phrases(short_id);
-- Alternative: Use test-phrases-v1.sql for databases without short_id column

-- =============================================================================
-- VALID PHRASES (should all work)
-- =============================================================================

-- All date/time variants in one phrase
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Date Time Combo',
  'Date: {{date}} | Long: {{date:long}} | Short: {{date:short}}
Tomorrow: {{date:+1}} | Yesterday: {{date:-1}} | Next week: {{date:+7}}
Custom: {{date:DD/MM/YYYY}} | {{date:MMMM D, YYYY}}
Time: {{time}} | 12h: {{time:12h}} | DateTime: {{datetime}}
Weekday: {{weekday}} | Month: {{month}} | Year: {{year}}',
  'plain',
  'test001'
);

-- Locale variants
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Localized Dates',
  'German: {{date@de}} | {{date:long@de}} | {{weekday@de}} | {{month@de}}
French: {{date@fr}} | {{date:long@fr}} | {{weekday@fr}} | {{month@fr}}
Spanish: {{date@es}} | {{weekday@es}}
US English: {{date@en-US}} | {{date:long@en-US}}
Offset+Locale: {{date:+1@de}} | {{date:-1@fr}}',
  'plain',
  'test002'
);

-- Offset + Format combinations (pipe separator)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Offset Format Combos',
  'Yesterday long: {{date:-1|long}}
Week ago short: {{date:-7|short}}
Next month custom: {{date:+30|DD/MM/YYYY}}
Tomorrow US format: {{date:+1|MM/DD/YYYY}}
Yesterday datetime: {{datetime:-1|short}}
Week ahead datetime: {{datetime:+7|long}}
Zero offset: {{date:0|long}} (same as today)
German yesterday: {{date:-1|long@de}}',
  'plain',
  'test003'
);

-- All input types in one phrase
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Input Types Test',
  'Basic: {{input:Name}}
With default: {{input:City=New York}}
Textarea: {{textarea:Description}}
Select: {{select:Priority=Low,*Medium,High}}
Labeled select: {{select:Status=Draft,*Review,Published}}
Multiple inputs: {{input:First}} and {{input:Second}}',
  'plain',
  'test004'
);

-- Reusable variable test
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Reusable Variable',
  'Dear {{input:Name}},

This confirms your appointment, {{input:Name}}.
We look forward to seeing you, {{input:Name}}.

Best regards',
  'plain',
  'test005'
);

-- Clipboard test
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Clipboard Tests',
  'Plain: {{clipboard}}
Quoted: "{{clipboard}}"
With date: {{clipboard}} (copied on {{date}})',
  'plain',
  'test006'
);

-- Escaped placeholders
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Escape Test',
  'Literal: \{{date}} | Actual: {{date}}
Literal input: \{{input:Name}} | Actual: {{input:Name}}
Mixed: Use \{{date}} for today ({{date}})',
  'plain',
  'test007'
);

-- Complex combined template
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Full Template',
  '# Report - {{date:long@en-US}}

**From:** {{input:Author=John Doe}}
**To:** {{input:Recipient}}
**Priority:** {{select:Priority=Low,*Normal,High,Urgent}}
**Status:** {{select:Status=*Draft,Review,Final}}

## Summary
{{textarea:Summary}}

## Notes
{{textarea:Notes}}

---
Generated on {{datetime}} ({{weekday}})',
  'markdown',
  'test008'
);

-- @ in labels (should work after fix)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Email Labels',
  'Contact: {{input:user@email.com}}
Work: {{input:Email@work=work@example.com}}
Personal: {{input:Email@personal}}',
  'plain',
  'test009'
);

-- =============================================================================
-- CROSS-INSERT TEST PHRASES (for testing nested phrases)
-- =============================================================================

-- Base phrase to be referenced by others
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'My Signature',
  'Best regards,
John Doe
CEO, ACME Inc.',
  'plain',
  'sig0001'
);

-- Phrase that includes another phrase
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Email with Signature',
  'Dear {{input:Recipient}},

Thank you for your email from {{date:-1|long}}.

{{phrase:sig0001}}',
  'plain',
  'email01'
);

-- Nested cross-insert (phrase containing phrase containing phrase)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Header Block',
  '=== HEADER ===
Date: {{date:long}}
Time: {{time}}',
  'plain',
  'head001'
);

INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Email Template',
  '{{phrase:head001}}

Dear {{input:Name}},

{{textarea:Body}}

{{phrase:sig0001}}',
  'plain',
  'templ01'
);

-- Cross-insert with dynamic content in referenced phrase
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Dynamic Signature',
  'Sent on {{date}} at {{time}}
From: {{input:Sender}}',
  'plain',
  'dsig001'
);

INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Report with Dynamic Sig',
  'Status Report

{{textarea:Content}}

---
{{phrase:dsig001}}',
  'plain',
  'rpt0001'
);

-- =============================================================================
-- INTENTIONALLY INVALID/EDGE CASES (for testing graceful handling)
-- =============================================================================

-- Cross-insert with invalid/unknown ID (should remain as-is)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Invalid Cross Insert',
  'This references a non-existent phrase: {{phrase:unknown}}
And this ID is too short: {{phrase:abc}}
And too long: {{phrase:toolongid}}',
  'plain',
  'test010'
);

-- Unknown placeholder types (should remain as-is)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Invalid Types',
  'Unknown: {{unknown}} | {{foo:bar}} | {{xyz:123}}
These should appear literally in output',
  'plain',
  'test011'
);

-- Malformed placeholders (should remain as-is or partial match)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Malformed Syntax',
  'Single brace: {date} | {input:Name}
Triple brace: {{{date}}}
Unclosed: {{date | {{input:Name
Empty: {{}} | {{ }}
Nested: {{date:{{time}}}}',
  'plain',
  'test012'
);

-- Invalid locale codes (should fallback gracefully)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Invalid Locales',
  'Bad code: {{date@xyz}} | {{date@123}}
Empty locale: {{date@}}
Too long: {{date@invalid-locale-code}}
Numeric: {{date@12345}}',
  'plain',
  'test013'
);

-- Invalid date options
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Invalid Date Options',
  'Bad offset: {{date:+abc}} | {{date:-}} | {{date:++5}}
Unknown format: {{date:foo}} | {{date:XXXXX}}
Empty option: {{date:}}',
  'plain',
  'test014'
);

-- Edge case: special characters
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Special Characters',
  'Quotes: {{input:Say "Hello"}}
Angle: {{input:Use <brackets>}}
Ampersand: {{input:Tom & Jerry}}
Unicode: {{input:名前}} | {{date:long@ja}}',
  'plain',
  'test015'
);

-- Empty and whitespace
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Empty Values',
  'Empty input: {{input:}}
Space label: {{input: }}
Empty select: {{select:}}
Empty textarea: {{textarea:}}',
  'plain',
  'test016'
);

-- Mixed valid and invalid in one phrase
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (
  'Mixed Valid Invalid',
  'Valid: {{date}} | Invalid: {{notadate}}
Valid: {{input:Name}} | Malformed: {input:Bad}
Valid: {{clipboard}} | Unknown: {{paste}}
Valid: {{time:12h}} | Bad: {{time:99h}}',
  'plain',
  'test017'
);
