const DIVISION_LABEL: Record<string, string> = {
  jouve: "Logística Jouve",
  dz: "DZ Instalaciones",
};

/** The division line every PDF prints under the issuer; an unknown division
 *  falls back to the channel name. */
export function divisionLabel(
  division: string | null | undefined,
  fallback: string,
): string {
  return (division && DIVISION_LABEL[division]) ?? fallback;
}
