'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Leaf, WifiOff } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AlmondMark } from './ui';

export default function AuthPage({ mode, unavailable, onRetry }: {
  mode: 'login' | 'register'; unavailable?: string; onRetry: () => void;
}) {
  const signup = mode === 'register';
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unavailable) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name') ?? '').trim();
    if (signup && !name) { setError('Enter your name to create an account.'); return; }
    setBusy(true); setError('');
    try {
      const credentials = { email: String(fields.get('email')).trim(), password: String(fields.get('password')) };
      const result = signup ? await authClient.signUp.email({ ...credentials, name }) : await authClient.signIn.email(credentials);
      if (result.error) throw new Error(result.error.message ?? 'Please check your details and try again.');
      if (!result.data?.user) throw new Error('No session was created. Please try again.');
      // The workspace gate verifies the cookie session before opening any saved data.
      window.location.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-story" aria-label="About Almond">
      <a className="brand" href="/login" aria-label="Almond sign in"><span className="brand-mark"><AlmondMark/></span><span>almond<span className="brand-dot">.</span></span></a>
      <div className="auth-story-copy"><span className="eyebrow">A CALMER PLACE FOR YOUR MONEY</span><h2>Small steps.<br/>Brighter tomorrows.</h2><p>A little clarity for your everyday spending. A little more room for what matters.</p><div className="auth-leaf" aria-hidden="true"><AlmondMark/></div></div>
      <p className="auth-story-foot"><Leaf size={18} aria-hidden="true"/>Made for your everyday.</p>
    </section>
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-content">
        <span className="eyebrow">YOUR PERSONAL SPACE</span>
        <h1 id="auth-title">{signup ? 'A fresh start with Almond.' : 'Welcome back to your space.'}</h1>
        <p className="auth-intro">{signup ? 'Create an account and take the first small step.' : 'Sign in to pick up where you left off.'}</p>
        {unavailable ? <div className="auth-unavailable"><p role="alert">{unavailable}</p><button className="button primary" onClick={onRetry}>Try again</button></div> : <form className="form-stack auth-form" onSubmit={submit} aria-busy={busy}>
          {signup && <label htmlFor="auth-name">Your name<input id="auth-name" name="name" autoComplete="name" maxLength={100} required disabled={busy}/></label>}
          <label htmlFor="auth-email">Email address<input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={busy}/></label>
          <div className="auth-password-field"><label htmlFor="auth-password">Password</label><div className="auth-password"><input id="auth-password" name="password" type={visible ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required disabled={busy} aria-describedby="password-hint"/><button type="button" className="icon-button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></div>
          <p id="password-hint" className="field-hint">{signup ? 'Use 12–128 characters. ' : ''}Password recovery is not available yet. Keep your password somewhere safe.</p>
          {error && <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">{error}</p>}
          <button className="button primary auth-submit" disabled={busy}>{busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={18} aria-hidden="true"/>}</button>
        </form>}
        <p className="auth-switch">{signup ? 'Already have an account?' : 'New to Almond?'} <a href={signup ? '/login' : '/register'}>{signup ? 'Sign in' : 'Create an account'}</a></p>
        <div className="auth-offline-note"><WifiOff size={18} aria-hidden="true"/><p>Sign in once, then keep going offline on this browser. Saved data is unencrypted; protect access to your device.</p></div>
      </div>
    </section>
  </main>;
}
