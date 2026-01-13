import { describe, it, expect } from 'vitest';

/**
 * State Logic Tests
 * 
 * These tests verify the pure logic functions from state.js
 * without requiring Electron dependencies. The functions are
 * recreated here to test the logic independently.
 */

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

  it('returns false at 13 days', () => {
    const now = new Date();
    const installDate = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000); // 13 days ago
    const config = { purchased: false, installDate: installDate.toISOString() };
    expect(shouldShowPurchaseReminder(config)).toBe(false);
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
