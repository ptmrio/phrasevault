-- Test Phrases for PhraseVault Dynamic Inserts (V1 Schema)
-- Use this for testing V1 -> V2 upgrade process
-- 1. Import this SQL into an existing database (overwrites phrases table)
-- 2. Launch app - it will run V2 upgrade and generate short_ids automatically

-- =============================================================================
-- DOWNGRADE DATABASE TO V1 SCHEMA
-- =============================================================================

-- Drop the V2 index first (must be done before recreating table)
DROP INDEX IF EXISTS idx_phrases_short_id;

-- Recreate phrases table WITHOUT short_id column (V1 schema)
-- SQLite doesn't support DROP COLUMN in older versions, so we recreate
DROP TABLE IF EXISTS phrases;
CREATE TABLE phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase TEXT,
    expanded_text TEXT,
    type TEXT DEFAULT 'plain',
    usageCount INTEGER DEFAULT 0,
    dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP,
    dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Set schema version to 1 (triggers V2 upgrade on next app launch)
DELETE FROM schema_version;
INSERT INTO schema_version (version) VALUES (1);

-- =============================================================================
-- VALID PHRASES
-- =============================================================================

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Date Time Combo',
  'Date: {{date}} | Long: {{date:long}} | Short: {{date:short}}
Tomorrow: {{date:+1}} | Yesterday: {{date:-1}} | Next week: {{date:+7}}
Custom: {{date:DD/MM/YYYY}} | {{date:MMMM D, YYYY}}
Time: {{time}} | 12h: {{time:12h}} | DateTime: {{datetime}}
Weekday: {{weekday}} | Month: {{month}} | Year: {{year}}',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Localized Dates',
  'German: {{date@de}} | {{date:long@de}} | {{weekday@de}} | {{month@de}}
French: {{date@fr}} | {{date:long@fr}} | {{weekday@fr}}
Offset+Locale: {{date:+1@de}} | {{date:-1@fr}}',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Offset Format Combos',
  'Yesterday long: {{date:-1|long}}
Week ago short: {{date:-7|short}}
Next month custom: {{date:+30|DD/MM/YYYY}}
German yesterday: {{date:-1|long@de}}',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Input Types Test',
  'Basic: {{input:Name}}
With default: {{input:City=New York}}
Textarea: {{textarea:Description}}
Select: {{select:Priority=Low,*Medium,High}}',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Reusable Variable',
  'Dear {{input:Name}},

This confirms your appointment, {{input:Name}}.
Best regards',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Clipboard Test',
  'Plain: {{clipboard}}
With date: {{clipboard}} (copied on {{date}})',
  'plain'
);

INSERT INTO phrases (phrase, expanded_text, type) VALUES (
  'Escape Test',
  'Literal: \{{date}} | Actual: {{date}}
Mixed: Use \{{date}} for today ({{date}})',
  'plain'
);
