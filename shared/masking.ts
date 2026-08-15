export function maskName(name: string): string {
  const chars = Array.from(name);

  if (chars.length === 0) return '';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;

  const first = chars[0];
  const last = chars[chars.length - 1];
  const middle = '*'.repeat(chars.length - 2);

  return `${first}${middle}${last}`;
}
