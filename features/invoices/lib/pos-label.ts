/** "0003 · Casa central": the AFIP point-of-sale number, plus its nickname. */
export function posLabel(p: {
  numero: number;
  nickname: string | null;
}): string {
  const numero = String(p.numero).padStart(4, "0");
  return p.nickname ? `${numero} · ${p.nickname}` : numero;
}
