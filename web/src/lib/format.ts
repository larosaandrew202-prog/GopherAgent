/* Small formatting helpers ported from console.js. */

export function formatTime(date: number | string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatSize(bytes: number): string {
  if (!bytes && bytes !== 0) return '';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function generateSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `session_${Date.now().toString(36)}_${rand}`;
}

export function firstLineSnippet(text: string, max = 40): string {
  const line = (text || '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Group a timestamp into today / yesterday / earlier for the session list. */
export function timeGroup(ts: number | string | undefined, labels: { today: string; yesterday: string; earlier: string }): string {
  if (!ts) return labels.earlier;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return labels.earlier;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return labels.today;
  if (t >= startOfToday - 86400000) return labels.yesterday;
  return labels.earlier;
}
