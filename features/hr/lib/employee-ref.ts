const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Whether a row is the employee a reference names: its exact id, or a name
 * that contains every word of the reference, ignoring case and accents
 * ("gomez" matches "Gómez Ana").
 */
export function matchesEmployeeRef(
  row: { employee_id: string; legal_name: string },
  ref: string,
): boolean {
  const trimmed = ref.trim();
  if (UUID.test(trimmed)) return row.employee_id === trimmed.toLowerCase();
  const name = fold(row.legal_name);
  return fold(trimmed)
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => name.includes(word));
}
