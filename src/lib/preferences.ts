export const PREFERENCES_KEY = 'almond-dashboard-preferences';
export const accents = ['sage', 'blue', 'plum'] as const;
export type Accent = typeof accents[number];
export const dashboardSections = {
  cashflow: 'Cashflow',
  spending: 'Category spending',
  recent: 'Recent transactions',
  budgets: 'Budget preview',
} as const;
export interface DashboardPreferences {
  version: 1;
  accent: Accent;
  sections: Record<keyof typeof dashboardSections, boolean>;
}
export function defaultPreferences(): DashboardPreferences {
  return { version: 1, accent: 'sage', sections: { cashflow: true, spending: true, recent: true, budgets: true } };
}
export function parsePreferences(raw: string | null): DashboardPreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || value.version !== 1 || !accents.includes(value.accent) || !value.sections ||
      !Object.keys(dashboardSections).every(key => typeof value.sections[key] === 'boolean')) return defaultPreferences();
    return { version: 1, accent: value.accent, sections: {
      cashflow: value.sections.cashflow, spending: value.sections.spending,
      recent: value.sections.recent, budgets: value.sections.budgets,
    } };
  } catch { return defaultPreferences(); }
}
export function loadPreferences(): DashboardPreferences {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return defaultPreferences(); }
}
export function savePreferences(value: DashboardPreferences): void {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value)); }
  catch { /* Optional browser preferences must not block the workspace. */ }
}
