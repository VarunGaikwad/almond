import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersDarkTheme } from '../src/lib/theme';

afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  for (const systemDark of [false, true]) {
    for (const saved of [null, 'light', 'dark', 'invalid']) {
      it(`uses saved ${saved} with system dark=${systemDark}`, () => {
        vi.stubGlobal('window', { matchMedia: () => ({ matches: systemDark }) });
        vi.stubGlobal('localStorage', { getItem: () => saved });
        const expected = saved === 'dark' ? true : saved === 'light' ? false : systemDark;
        expect(prefersDarkTheme()).toBe(expected);
      });
    }
  }

  it('uses the system theme when storage is unavailable', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); } });
    expect(prefersDarkTheme()).toBe(true);
  });

  it('is safe outside the browser', () => {
    vi.stubGlobal('window', undefined);
    expect(prefersDarkTheme()).toBe(false);
  });
});
