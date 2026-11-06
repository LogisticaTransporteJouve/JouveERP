/** Patente or fuel card as compared: uppercase letters and digits only. */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
