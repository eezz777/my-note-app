// 날짜 표시: 오늘은 시각, 올해는 월/일, 그 외는 연도 포함
export function formatDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
