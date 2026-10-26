export function prefersDarkTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem('almond-theme');
    if (saved === 'dark' || saved === 'light') return saved === 'dark';
  } catch { /* Optional preference. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
