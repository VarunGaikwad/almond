export async function sendPasswordResetEmail({ user, url }: { user: { email: string }; url: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new Error('Password recovery email is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [user.email], subject: 'Reset your Almond password',
      text: `Reset your Almond password using this link:\n\n${url}\n\nThis link expires in one hour and can only be used once. If you did not request this, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Provider messages can contain recipient addresses or other sensitive data.
    const detail: unknown = await response.json().catch(() => null);
    const name = detail && typeof detail === 'object' && 'name' in detail ? detail.name : undefined;
    const safeNames = ['validation_error', 'missing_api_key', 'invalid_api_key', 'restricted_api_key',
      'unverified_domain', 'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded',
      'application_error', 'internal_server_error'];
    const code = typeof name === 'string' && safeNames.includes(name) ? `, ${name}` : '';
    throw new Error(`Password recovery email could not be sent (Resend HTTP ${response.status}${code})`);
  }
}
