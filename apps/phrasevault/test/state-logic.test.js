import { describe, it, expect } from 'vitest';

/**
 * State Logic Tests
 * 
 * These tests verify the pure logic functions from state.js
 * without requiring Electron dependencies. The functions are
 * recreated here to test the logic independently.
 */

// ============================================
// LEGACY MIGRATION LOGIC
// ============================================
// Note: Purchase reminder logic is now handled by the shared licensing system.
// See packages/shared/test/licensing/trial.test.ts for comprehensive tests.

describe('shouldShowLegacyMigration logic', () => {
  /**
   * Determines if the legacy migration modal should be shown.
   * This is for users who used the old "honor system" purchase
   * (config.purchased = true) but haven't migrated to a real license key.
   */
  function shouldShowLegacyMigration(config, hasValidLicense) {
    return config.purchased === true && !hasValidLicense;
  }

  it('returns true for honor-system purchaser without license', () => {
    const config = { purchased: true };
    expect(shouldShowLegacyMigration(config, false)).toBe(true);
  });

  it('returns false for honor-system purchaser with valid license', () => {
    const config = { purchased: true };
    expect(shouldShowLegacyMigration(config, true)).toBe(false);
  });

  it('returns false for new users without purchase flag', () => {
    const config = { purchased: false };
    expect(shouldShowLegacyMigration(config, false)).toBe(false);
  });

  it('returns false for licensed users without purchase flag', () => {
    const config = { purchased: false };
    expect(shouldShowLegacyMigration(config, true)).toBe(false);
  });

  it('returns false when purchased is undefined', () => {
    const config = {};
    expect(shouldShowLegacyMigration(config, false)).toBe(false);
  });

  it('returns false when purchased is null', () => {
    const config = { purchased: null };
    expect(shouldShowLegacyMigration(config, false)).toBe(false);
  });

  it('returns false when purchased is string "true"', () => {
    // Strict boolean check - string "true" should not trigger migration
    const config = { purchased: 'true' };
    expect(shouldShowLegacyMigration(config, false)).toBe(false);
  });
});

describe('clearLegacyPurchasedFlag logic', () => {
  /**
   * Clears the legacy purchased flag after successful license activation.
   * This prevents the migration modal from showing again.
   */
  function clearLegacyPurchasedFlag(config) {
    if (config.purchased) {
      return { ...config, purchased: false };
    }
    return config;
  }

  it('clears purchased flag when true', () => {
    const config = { purchased: true, theme: 'dark' };
    const result = clearLegacyPurchasedFlag(config);
    expect(result.purchased).toBe(false);
    expect(result.theme).toBe('dark'); // preserves other fields
  });

  it('no-op when purchased is false', () => {
    const config = { purchased: false };
    const result = clearLegacyPurchasedFlag(config);
    expect(result).toEqual(config);
  });

  it('no-op when purchased is undefined', () => {
    const config = { theme: 'light' };
    const result = clearLegacyPurchasedFlag(config);
    expect(result).toEqual(config);
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

  it('does not duplicate existing file', () => {
    const result = addRecentFile(['a', 'b', 'c'], 'a');
    expect(result).toEqual(['a', 'b', 'c']);
    expect(result.filter(f => f === 'a')).toHaveLength(1);
  });

  it('preserves order of other files when moving to front', () => {
    const result = addRecentFile(['a', 'b', 'c', 'd'], 'c');
    expect(result).toEqual(['c', 'a', 'b', 'd']);
  });
});

// ============================================
// LICENSE AGREEMENT LOGIC
// ============================================

describe('license agreement logic', () => {
  function shouldShowLicenseAgreement(config) {
    return config.licenseAgreed !== 'SPQRK SOFTWARE LICENSE v1.1';
  }

  it('returns true if not agreed', () => {
    expect(shouldShowLicenseAgreement({ licenseAgreed: false })).toBe(true);
  });

  it('returns true if agreed to different version', () => {
    expect(shouldShowLicenseAgreement({ licenseAgreed: 'OLD LICENSE' })).toBe(true);
  });

  it('returns false if agreed to current version', () => {
    expect(shouldShowLicenseAgreement({ licenseAgreed: 'SPQRK SOFTWARE LICENSE v1.1' })).toBe(false);
  });

  it('returns true if licenseAgreed is undefined', () => {
    expect(shouldShowLicenseAgreement({})).toBe(true);
  });

  it('returns true if licenseAgreed is null', () => {
    expect(shouldShowLicenseAgreement({ licenseAgreed: null })).toBe(true);
  });

  it('returns true if licenseAgreed is empty string', () => {
    expect(shouldShowLicenseAgreement({ licenseAgreed: '' })).toBe(true);
  });
});

// ============================================
// CONFIG MERGE LOGIC
// ============================================

describe('config merge logic', () => {
  function setConfig(currentConfig, newConfig) {
    return { ...currentConfig, ...newConfig };
  }

  it('merges new values into config', () => {
    const current = { theme: 'light', autostart: true };
    const result = setConfig(current, { theme: 'dark' });
    expect(result).toEqual({ theme: 'dark', autostart: true });
  });

  it('adds new keys to config', () => {
    const current = { theme: 'light' };
    const result = setConfig(current, { newKey: 'value' });
    expect(result).toEqual({ theme: 'light', newKey: 'value' });
  });

  it('preserves unmodified keys', () => {
    const current = { a: 1, b: 2, c: 3 };
    const result = setConfig(current, { b: 20 });
    expect(result).toEqual({ a: 1, b: 20, c: 3 });
  });

  it('handles empty update', () => {
    const current = { a: 1 };
    const result = setConfig(current, {});
    expect(result).toEqual({ a: 1 });
  });
});
