/** "Origen → Destino", with a dash for the missing end. */
export function formatRoute(
  origin: string | null,
  destination: string | null,
): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}
