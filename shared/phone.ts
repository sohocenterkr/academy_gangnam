export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function maskPhone(phoneNormalized: string): string {
  const digits = phoneNormalized.replace(/\D/g, '');

  if (digits.length === 0) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  if (digits.length < 7) {
    const tail = digits.slice(-4);
    return `${'*'.repeat(digits.length - 4)}-${tail}`;
  }

  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  const middleLength = digits.length - head.length - tail.length;

  return middleLength > 0 ? `${head}-${'*'.repeat(middleLength)}-${tail}` : `${head}-${tail}`;
}
