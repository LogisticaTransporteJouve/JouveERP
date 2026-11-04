import {
  bookNotes,
  comprasBook,
  CONDITION_LEGEND,
  type LibroIvaHeader,
  TC_LEGEND,
} from "@/features/libro-iva/lib/book-layout";
import {
  COMPRAS_PERCEPTIONS_LEGEND,
  type LibroIvaComprasRow,
} from "@/features/libro-iva/schema";

import { LibroIvaPdfDocument, planLibroIvaPdf } from "./libro-iva-book-pdf";

export interface LibroIvaComprasTemplateData {
  period: string;
  channelName: string;
  generatedAt: string;
  header: LibroIvaHeader;
  rows: LibroIvaComprasRow[];
}

/** The book and its page plan (exported for the page-count test). */
export function libroIvaComprasPlan(rows: readonly LibroIvaComprasRow[]) {
  const model = comprasBook(rows);
  return {
    model,
    plan: planLibroIvaPdf(
      model,
      bookNotes(model, [
        COMPRAS_PERCEPTIONS_LEGEND,
        TC_LEGEND,
        CONDITION_LEGEND,
      ]),
    ),
  };
}

export function LibroIvaComprasDocument({
  period,
  channelName,
  generatedAt,
  header,
  rows,
}: LibroIvaComprasTemplateData) {
  const { model, plan } = libroIvaComprasPlan(rows);
  return (
    <LibroIvaPdfDocument
      model={model}
      plan={plan}
      period={period}
      header={header}
      subtitle={`${channelName} · ${model.docs.length} comprobantes · importes en pesos (moneda extranjera a la cotización de cada comprobante)`}
      generatedAt={generatedAt}
    />
  );
}
