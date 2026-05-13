import type { IvaCondition } from "@/features/clients/schema";

import type { OriginInvoice } from "../components/issue-nc-nd-dialog";
import type { ComprobanteDetail } from "../actions/invoices-actions";

export function toOriginInvoice(detail: ComprobanteDetail): OriginInvoice {
  if (!detail.letter) {
    throw new Error("Solo facturas fiscales emitidas pueden ser origen de NC/ND.");
  }
  return {
    id: detail.id,
    channel_id: detail.channel.id,
    letter: detail.letter as "A" | "B" | "C",
    punto_venta: detail.punto_venta,
    fecha: detail.fecha,
    concepto: detail.concepto,
    doc_nro: detail.doc_nro,
    client: {
      id: detail.client.id,
      legal_name: detail.client.legal_name,
      iva_condition: detail.client.iva_condition as IvaCondition,
    },
    items: detail.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      iva_rate_id: it.iva_rate_id,
    })),
  };
}
