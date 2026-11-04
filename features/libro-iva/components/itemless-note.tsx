import { type PerRate, SIN_ALICUOTA } from "../schema";

/** Documents without items: where the book puts their neto and IVA. */
export function ItemlessNote({
  docs,
}: {
  docs: readonly { has_items: boolean; per_rate: PerRate }[];
}) {
  const itemless = docs.filter((d) => !d.has_items);
  if (itemless.length === 0) return null;
  const unrated = itemless.filter(
    (d) => d.per_rate[SIN_ALICUOTA] !== undefined,
  ).length;
  return (
    <p>
      <span className="font-medium">{itemless.length}</span> comprobante(s){" "}
      <span className="font-medium">sin ítems</span> (por ejemplo, importados de
      ARCA): su neto y su IVA van en la alícuota que surge de IVA / neto, la
      misma que declara el TXT.
      {unrated > 0 && (
        <>
          {" "}
          <span className="font-medium">{unrated}</span> no cierra(n) con
          ninguna alícuota: quedan en la columna «Sin alícuota» y el TXT los
          excluye. Revisalos antes de presentar.
        </>
      )}
    </p>
  );
}
