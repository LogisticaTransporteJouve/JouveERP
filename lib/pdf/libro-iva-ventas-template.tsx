import {
  bookNotes,
  CONDITION_LEGEND,
  type LibroIvaHeader,
  TC_LEGEND,
  ventasBook,
} from "@/features/libro-iva/lib/book-layout";
import type { LibroIvaVentasRow } from "@/features/libro-iva/schema";

import { LibroIvaPdfDocument, planLibroIvaPdf } from "./libro-iva-book-pdf";

export interface LibroIvaVentasTemplateData {
  period: string;
  channelName: string;
  generatedAt: string;
  header: LibroIvaHeader;
  rows: LibroIvaVentasRow[];
}

/** The book and its page plan (exported for the page-count test). */
export function libroIvaVentasPlan(rows: readonly LibroIvaVentasRow[]) {
  const model = ventasBook(rows);
  return {
    model,
    plan: planLibroIvaPdf(
      model,
      bookNotes(model, [TC_LEGEND, CONDITION_LEGEND]),
    ),
  };
}

export function LibroIvaVentasDocument({
  period,
  channelName,
  generatedAt,
  header,
  rows,
}: LibroIvaVentasTemplateData) {
  const { model, plan } = libroIvaVentasPlan(rows);
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
