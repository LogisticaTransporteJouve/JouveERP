import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import {
  buildInvoiceQRUrl,
  renderInvoiceQR,
  type InvoiceQRPayload,
} from "@/lib/afip/qr";
import { renderInvoicePdf } from "@/lib/pdf/render";
import type { InvoiceTemplateData } from "@/lib/pdf/invoice-template";

// Runs as a Vitest test (so the server-only alias kicks in) but its real
// purpose is to drop two PDFs into /tmp for manual review of the template.
//
//   pnpm vitest run scripts/preview-pdf.test.tsx
//
// Both PDFs are written; the test passes as long as no exception escapes.

describe("invoice PDF preview", () => {
  it("emits fiscal + internal samples to a tmp dir", async () => {
    const fiscalQrPayload: InvoiceQRPayload = {
      fecha: "2026-05-09",
      cuit: "30714637432",
      ptoVta: 3,
      tipoCmp: 6,
      nroCmp: 124,
      importe: 121,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 30714637432,
      tipoCodAut: "E",
      codAut: "70333333401",
    };

    const fiscal: InvoiceTemplateData = {
      isFiscal: true,
      emisor: {
        legal_name: "DZ & Sons S.A.",
        cuit: "30714637432",
        iva_condition: "IVA Responsable Inscripto",
        address: "Av. Siempre Viva 742, CABA",
        division_label: "Logística Jouve",
        iibb_number: "no contribuyente",
        inicio_actividades: "2010-01-01",
      },
      receptor: {
        legal_name: "PALLET SIRANS S.R.L.",
        doc_tipo_label: "CUIT",
        doc_nro: "30718543866",
        iva_condition_label: "Responsable Inscripto",
        condicion_iva_receptor: 1,
        address: "Calle Falsa 123, La Matanza, BA",
      },
      kind: "factura",
      letter: "B",
      punto_venta: 3,
      numero: 124,
      fecha: "2026-05-09",
      fch_serv_desde: "2026-05-01",
      fch_serv_hasta: "2026-05-31",
      fch_vto_pago: "2026-06-15",
      concepto_label: "Servicios",
      items: [
        {
          description: "Flete CABA → Mar del Plata 18/4/2026",
          quantity: 1,
          unit_price: 80,
          iva_rate_id: 5,
          line_neto: 80,
          line_total: 96.8,
        },
        {
          description: "Estadía pallets (8 días)",
          quantity: 8,
          unit_price: 2.5,
          iva_rate_id: 5,
          line_neto: 20,
          line_total: 24.2,
        },
      ],
      imp_neto: 100,
      imp_iva: 21,
      imp_trib: 0,
      imp_tot_conc: 0,
      imp_op_ex: 0,
      imp_total: 121,
      per_rate: [{ id: 5, base: 100, importe: 21 }],
      moneda: "PES",
      cotizacion: 1,
      cae: "70333333401",
      cae_vencimiento: "2026-05-19",
      qr_data_url: await renderInvoiceQR(fiscalQrPayload),
    };

    const internal: InvoiceTemplateData = {
      ...fiscal,
      isFiscal: false,
      letter: null,
      cae: null,
      cae_vencimiento: null,
      qr_data_url: null,
      items: [
        {
          description: "Servicio interno — sin valor fiscal",
          quantity: 1,
          unit_price: 100,
          iva_rate_id: null,
          line_neto: 100,
          line_total: 100,
        },
      ],
      imp_neto: 100,
      imp_iva: 0,
      imp_trib: 0,
      imp_tot_conc: 0,
      imp_op_ex: 0,
      imp_total: 100,
      per_rate: [],
    };

    console.log("\nQR canonical URL:");
    console.log(buildInvoiceQRUrl(fiscalQrPayload));

    const dir = mkdtempSync(join(tmpdir(), "jouve-preview-"));
    const fiscalPath = join(dir, "fiscal-factura-b.pdf");
    const internalPath = join(dir, "internal-comprobante.pdf");

    const fiscalPdf = await renderInvoicePdf(fiscal);
    writeFileSync(fiscalPath, fiscalPdf);
    console.log(
      `\nFiscal PDF (2 pages: ORIGINAL + DUPLICADO):\n  ${fiscalPath}  (${fiscalPdf.length} bytes)`,
    );

    const internalPdf = await renderInvoicePdf(internal);
    writeFileSync(internalPath, internalPdf);
    console.log(
      `Internal PDF (1 page):\n  ${internalPath}  (${internalPdf.length} bytes)\n`,
    );
  });
});
