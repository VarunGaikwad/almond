'use client';
import { accents, dashboardSections, defaultPreferences, type DashboardPreferences as Preferences } from '@/lib/preferences';

export function DashboardPreferences({ value, onChange }: { value: Preferences; onChange: (value: Preferences) => void }) {
  return <section className="card settings-section">
    <div className="card-heading"><div><h2>Your dashboard, your way</h2><p>Saved in this browser, not synced to other devices.</p></div></div>
    <div className="settings-content dashboard-preferences">
      <fieldset><legend>Accent color</legend><div className="inline-actions">{accents.map(accent =>
        <button type="button" key={accent} className={`button ${value.accent === accent ? 'primary' : 'secondary'}`} aria-pressed={value.accent === accent} onClick={() => onChange({ ...value, accent })}>{accent[0].toUpperCase() + accent.slice(1)}</button>,
      )}</div></fieldset>
      <fieldset><legend>Overview sections</legend><p className="muted">Your summary always stays visible. Reports are not affected.</p>
        {Object.entries(dashboardSections).map(([key, label]) => {
          const section = key as keyof Preferences['sections'];
          return <label className="preference-checkbox" key={key}><input type="checkbox" checked={value.sections[section]} onChange={e => onChange({ ...value, sections: { ...value.sections, [section]: e.target.checked } })}/>{label}</label>;
        })}
      </fieldset>
      <button type="button" className="button secondary" onClick={() => onChange(defaultPreferences())}>Reset dashboard defaults</button>
    </div>
  </section>;
}
