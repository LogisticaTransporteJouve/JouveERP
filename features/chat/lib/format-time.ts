// Helpers de formato de fecha para el sidebar y los message bubbles.
// No usamos date-fns para mantener el bundle chico — son cuatro líneas
// de lógica que no pasa nada con tener inline.

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
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
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
