// How numbers, durations and dates read in the report.

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${String(minutes)} min ${String(rest)} s`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

export function formatPercent(part: number, whole: number): string {
  if (whole === 0) return '0 %';
  const value = (part / whole) * 100;
  return `${value >= 99.95 || value === 0 ? value.toFixed(0) : value.toFixed(1)} %`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function shortCommit(commit: string | null): string {
  return commit === null ? 'unknown commit' : commit.slice(0, 7);
}
