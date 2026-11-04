import { undiscriminatedNote } from "../lib/book-layout";
import { type PerRate, SIN_ALICUOTA, SIN_DISCRIMINAR } from "../schema";

type NoteDoc = { has_items: boolean; per_rate: PerRate };

const isUndiscriminated = (d: NoteDoc) =>
  d.per_rate[SIN_DISCRIMINAR] !== undefined;

/** Whether `ItemlessNote` has anything to say about these documents. */
export function hasItemlessNote(docs: readonly NoteDoc[]): boolean {
  return docs.some((d) => !d.has_items || isUndiscriminated(d));
}

/** Documents without items and B/C purchases: where the book puts their
 *  amounts, and whether the TXT declares them the same way. */
export function ItemlessNote({ docs }: { docs: readonly NoteDoc[] }) {
  const itemless = docs.filter((d) => !d.has_items && !isUndiscriminated(d));
  const undiscriminated = docs.filter(isUndiscriminated).length;
  if (itemless.length === 0 && undiscriminated === 0) return null;
  const unrated = itemless.filter(
    (d) => d.per_rate[SIN_ALICUOTA] !== undefined,
  ).length;
  return (
    <>
      {itemless.length > 0 && (
        <p>
          <span className="font-medium">{itemless.length}</span> comprobante(s){" "}
          <span className="font-medium">sin ítems</span> (por ejemplo,
          importados de ARCA): su neto y su IVA van en la alícuota que surge de
          IVA / neto, la misma que declara el TXT.
          {unrated > 0 && (
            <>
              {" "}
              <span className="font-medium">{unrated}</span> no cierra(n) con
              ninguna alícuota: quedan en la columna «Sin alícuota» y el TXT los
              excluye. Revisalos antes de presentar.
            </>
          )}
        </p>
      )}
      {undiscriminated > 0 && <p>{undiscriminatedNote(undiscriminated)}</p>}
    </>
  );
}
