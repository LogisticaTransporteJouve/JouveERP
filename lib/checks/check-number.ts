/** A cheque number as the key that tells two cheques apart: digits only,
 *  without leading zeros (banks pad it to different widths). */
export function checkNumberKey(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+/, "");
}
