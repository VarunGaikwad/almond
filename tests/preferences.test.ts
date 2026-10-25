import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accents, defaultPreferences, loadPreferences, parsePreferences, PREFERENCES_KEY, savePreferences } from '@/lib/preferences';

afterEach(() => vi.unstubAllGlobals());
describe('browser dashboard preferences', () => {
  it.each([null, '', '{', 'null', '[]', '{}', JSON.stringify({ ...defaultPreferences(), version: 2 }), JSON.stringify({ ...defaultPreferences(), accent: 'unknown' }), JSON.stringify({ ...defaultPreferences(), sections: { cashflow: 'false' } })])('falls back safely for invalid storage: %s', raw => {
    expect(parsePreferences(raw)).toEqual(defaultPreferences());
  });
  it('round trips each named accent and hidden sections without retaining unknown fields', () => {
    for (const accent of accents) {
      const value = { ...defaultPreferences(), accent, sections: { cashflow: false, spending: true, recent: false, budgets: false } };
      expect(parsePreferences(JSON.stringify({ ...value, extra: 'ignored' }))).toEqual(value);
    }
    const first = defaultPreferences(); first.sections.cashflow = false;
    expect(defaultPreferences().sections.cashflow).toBe(true);
  });
  it('persists locally and resetting replaces saved preferences with defaults', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const value = { ...defaultPreferences(), accent: 'plum' as const };
    savePreferences(value);
    expect(storage.has(PREFERENCES_KEY)).toBe(true);
    expect(loadPreferences()).toEqual(value);
    savePreferences(defaultPreferences());
    expect(loadPreferences()).toEqual(defaultPreferences());
  });
  it('survives blocked and unavailable localStorage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadPreferences()).toEqual(defaultPreferences());
    expect(() => savePreferences(defaultPreferences())).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(loadPreferences()).toEqual(defaultPreferences());
    expect(() => savePreferences(defaultPreferences())).not.toThrow();
  });
});

// Verify actual CSS token pairs rather than a second, disconnected palette.
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
function tokens(selector: string) {
  const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]+)/gi)].map(match => [match[1], match[2]]));
}
function luminance(hex: string) {
  const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  const rgb = [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
describe('accent text contrast', () => {
  for (const dark of [false, true]) for (const accent of accents) {
    it(`${accent} in ${dark ? 'dark' : 'light'} mode meets WCAG AA`, () => {
      const palette = { ...tokens(':root'), ...(dark ? tokens(':root[data-theme=dark]') : {}), ...(accent !== 'sage' ? tokens(`:root${dark ? '[data-theme=dark]' : ''}[data-accent=${accent}]`) : {}) };
      for (const background of ['surface', 'bg', 'primary-soft']) expect(contrast(palette.primary, palette[background])).toBeGreaterThanOrEqual(4.5);
      for (const background of ['primary', 'primary-hover']) expect(contrast(dark ? '#1c2715' : '#fff', palette[background])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette['sage-text'], palette.sage)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
