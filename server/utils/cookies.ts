export const SESSION_COOKIE_NAME = 'academy_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(';').map((part) => part.trim());
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq);
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

export function buildSessionCookie(token: string, isProduction: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildExpiredSessionCookie(isProduction: boolean): string {
  const attributes = [`${SESSION_COOKIE_NAME}=;`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}
