// Date formatting helpers for the sidebar and the message bubbles.
// We don't use date-fns to keep the bundle small — it's four lines
// of logic that are fine to have inline.

const DAY_MS = 86_400_000;

export function formatRelativeShort(
  iso: string | null,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < DAY_MS * 7) return `${Math.floor(diff / DAY_MS)}d`;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatMessageDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
  );
}

export function withinMinutes(a: string, b: string, minutes: number): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= minutes * 60_000;
}
