import { describe, it, expect } from 'vitest';
import enLocale from '../locales/en.js';
import deLocale from '../locales/de.js';
import esLocale from '../locales/es.js';
import frLocale from '../locales/fr.js';
import itLocale from '../locales/it.js';
import ptLocale from '../locales/pt.js';

const locales = {
  en: enLocale,
  de: deLocale,
  es: esLocale,
  fr: frLocale,
  it: itLocale,
  pt: ptLocale
};
const localeNames = Object.keys(locales);

describe('Locale Files', () => {
  // ============================================
  // KEY PARITY TESTS
  // ============================================

  describe('key parity', () => {
    const enKeys = Object.keys(enLocale.translation).sort();

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

  // ============================================
  // DYNAMIC INSERT KEYS TESTS
  // ============================================

  describe('dynamic insert translation keys', () => {
    const dynamicInsertKeys = [
      'Fill in Details',
      'Insert',
      'Value',
      'Text',
      'Cancel'
    ];

    localeNames.forEach(localeName => {
      it(`${localeName} has all dynamic insert keys`, () => {
        dynamicInsertKeys.forEach(key => {
          expect(locales[localeName].translation).toHaveProperty(key);
          expect(locales[localeName].translation[key].length).toBeGreaterThan(0);
        });
      });
    });
  });
});
