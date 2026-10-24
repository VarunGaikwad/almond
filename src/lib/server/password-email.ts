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
  if (!response.ok) throw new Error('Password recovery email could not be sent');
}
