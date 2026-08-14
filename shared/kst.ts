const KST_TIME_ZONE = 'Asia/Seoul';

export function getTodayKST(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the business-date shape we need.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getNowKSTISOString(date: Date = new Date()): string {
  const datePart = getTodayKST(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: KST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return `${datePart}T${timePart}+09:00`;
}
