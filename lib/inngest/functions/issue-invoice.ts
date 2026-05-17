import {
  AfipServiceError,
  AfipTransportError,
} from "@/lib/afip/errors";
import {
  getLastAuthorizedNumber,
  getVoucherInfo,
  requestCAE,
  type InvoiceCAEResult,
  type InvoiceIvaEntry,
  type InvoiceRequestInput,
} from "@/lib/afip/wsfev1";
import type { CbteTipoCode, IvaRateId } from "@/lib/afip/codes";
import { isServiciosConcepto } from "@/lib/afip/codes";
import { rpcAs } from "@/lib/db/rpc";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  INVOICE_ISSUE_REQUESTED,
  InvoiceIssueRequestedSchema,
} from "../events";

// `issueInvoice` orchestrates the durable emission flow for comprobantes.
// Two branches based on `channel.is_fiscal`:
//
// FISCAL (AFIP):
//   load-draft       → snapshot the row + channel (status flips draft → emitting)
//   reserve-numero   → ask AFIP for the last authorized number for the POS
//   persist-numero   → store number before requesting the CAE so a crashed
//                      retry can recover via FECompConsultar
//   request-cae      → call FECAESolicitar; on transport error, ask AFIP
//                      "did you actually register this number?" before
//                      letting Inngest retry. If AFIP did, adopt that CAE.
//   persist-cae      → store CAE + flip status to emitted.
//   generate-pdf     → render fiscal PDF (CAE + QR).
//
// INTERNAL (no AFIP):
//   load-draft       → idem.
//   reserve-and-persist-numero-internal → max(numero) + 1 over the same
//                      (channel_id, punto_venta, kind) tuple, in a single
//                      step. There's no AFIP roundtrip so a retry just
//                      re-reads max+1 and inserts again — the unique index
//                      rejects duplicates if the previous attempt persisted.
//   mark-emitted     → flip status to emitted (no CAE, no QR).
//   generate-pdf     → render the "Documento no fiscal" PDF.
//
// Idempotency is event-level (`event.data.idempotency_key`) so duplicate
// dispatches don't trigger duplicate runs. The DB also enforces uniqueness
// on `idempotency_key` so duplicate drafts can't be created.

const RETRYABLE_LIMIT = 5;

type DraftRow = {
  id: string;
  channel_id: string;
  client_id: string;
  kind: string;
  punto_venta: number;
  cbte_tipo_afip: number | null;
  fecha: string;
  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
  fch_vto_pago: string | null;
  concepto: number;
  doc_tipo: number;
  doc_nro: string;
  iva_condition_receptor: number | null;
  imp_neto: string | number;
  imp_iva: string | number;
  imp_trib: string | number;
  imp_tot_conc: string | number;
  imp_op_ex: string | number;
  imp_total: string | number;
  moneda: string;
  cotizacion: string | number;
  status: string;
  invoice_origin_id: string | null;
};

type ItemRow = {
  iva_rate_id: number | null;
  line_neto: string | number;
  line_iva: string | number;
};

type OriginRow = {
  punto_venta: number;
  cbte_tipo_afip: number | null;
  numero: number;
};

/** Shape de la join `channel:invoicing_channels(id, is_fiscal, name)` embebida
 *  en el draft cuando se lee con select expandido en issue-invoice. */
type DraftChannelJoin = {
  channel: { id: string; is_fiscal: boolean; name: string } | null;
};

type DraftLoad = {
  draft: DraftRow;
  iva: InvoiceIvaEntry[];
  origenes: Array<{ tipo: number; ptoVta: number; nro: number }>;
  channelIsFiscal: boolean;
  channelKind: string;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function aggregateIva(items: ItemRow[]): InvoiceIvaEntry[] {
  const buckets = new Map<number, { base: number; importe: number }>();
  for (const item of items) {
    if (item.iva_rate_id === null) continue;
    const base = round2(toNumber(item.line_neto));
    const importe = round2(toNumber(item.line_iva));
    const bucket = buckets.get(item.iva_rate_id) ?? { base: 0, importe: 0 };
    bucket.base = round2(bucket.base + base);
    bucket.importe = round2(bucket.importe + importe);
    buckets.set(item.iva_rate_id, bucket);
  }
  const out: InvoiceIvaEntry[] = [];
  for (const [id, b] of buckets) {
    out.push({ id: id as IvaRateId, baseImp: b.base, importe: b.importe });
  }
  return out;
}

function buildAfipInput(load: DraftLoad, cbteNro: number): InvoiceRequestInput {
  const draft = load.draft;
  if (draft.cbte_tipo_afip === null || draft.iva_condition_receptor === null) {
    throw new Error(
      "Fiscal comprobante missing cbte_tipo_afip or iva_condition_receptor.",
    );
  }
  const useServicePeriod = isServiciosConcepto(draft.concepto);
  return {
    ptoVta: draft.punto_venta,
    cbteTipo: draft.cbte_tipo_afip as CbteTipoCode,
    cbteNro,
    fecha: draft.fecha,
    concepto: draft.concepto as 1 | 2 | 3,
    docTipo: draft.doc_tipo as InvoiceRequestInput["docTipo"],
    docNro: draft.doc_nro,
    impTotal: toNumber(draft.imp_total),
    impNeto: toNumber(draft.imp_neto),
    impIva: toNumber(draft.imp_iva),
    impTotConc: toNumber(draft.imp_tot_conc),
    impOpEx: toNumber(draft.imp_op_ex),
    impTrib: toNumber(draft.imp_trib),
    monId: draft.moneda as InvoiceRequestInput["monId"],
    monCotiz: toNumber(draft.cotizacion),
    condicionIvaReceptorId:
      draft.iva_condition_receptor as InvoiceRequestInput["condicionIvaReceptorId"],
    fchServDesde: useServicePeriod ? draft.fch_serv_desde : null,
    fchServHasta: useServicePeriod ? draft.fch_serv_hasta : null,
    fchVtoPago: useServicePeriod ? draft.fch_vto_pago : null,
    iva: load.iva,
    cbtesAsoc: load.origenes.map((o) => ({
      tipo: o.tipo as CbteTipoCode,
      ptoVta: o.ptoVta,
      nro: o.nro,
    })),
  };
}

export const issueInvoice = inngest.createFunction(
  {
    id: "issue-invoice",
    name: "Issue invoice (request CAE)",
    triggers: [{ event: INVOICE_ISSUE_REQUESTED }],
    idempotency: "event.data.idempotency_key",
    retries: RETRYABLE_LIMIT,
    onFailure: async ({ event, error }) => {
      const supabase = getServiceClient();
      const originalData = (event.data as { event?: { data?: unknown } }).event
        ?.data;
      const parsed = InvoiceIssueRequestedSchema.safeParse(originalData);
      if (!parsed.success) {
        logger.warn("issue_invoice.failed_unparseable_event", {
          err: error.message,
        });
        return;
      }
      logger.warn("issue_invoice.failed", {
        invoice_id: parsed.data.invoice_id,
        err: error.message,
      });
      await supabase
        .from("invoices")
        .update({
          status: "failed",
          afip_observaciones: { error: error.message } as never,
        })
        .eq("id", parsed.data.invoice_id);
    },
  },
  async ({ event, step }) => {
    const parsed = InvoiceIssueRequestedSchema.parse(event.data);
    const { invoice_id } = parsed;

    const load: DraftLoad = await step.run("load-draft", async () => {
      const supabase = getServiceClient();
      const { data: draft, error } = await supabase
        .from("invoices")
        .select(
          "*, channel:invoicing_channels(id, is_fiscal, name)",
        )
        .eq("id", invoice_id)
        .maybeSingle();
      if (error) throw new Error(`load-draft: ${error.message}`);
      if (!draft) throw new Error(`Comprobante ${invoice_id} no existe.`);
      if (draft.status !== "draft" && draft.status !== "emitting") {
        throw new Error(
          `Comprobante ${invoice_id} en estado ${draft.status} — no se puede emitir.`,
        );
      }

      const channel = (draft as unknown as DraftChannelJoin).channel;
      if (!channel) {
        throw new Error(
          `Comprobante ${invoice_id} — canal no encontrado.`,
        );
      }

      const [{ data: items, error: itemsErr }, originPair] = await Promise.all([
        supabase
          .from("invoice_items")
          .select("iva_rate_id, line_neto, line_iva")
          .eq("invoice_id", invoice_id),
        loadOrigen(supabase, draft.invoice_origin_id),
      ]);
      if (itemsErr) throw new Error(`load-items: ${itemsErr.message}`);

      // Flip status to emitting so duplicate clicks that bypass Inngest's
      // dedupe still get rejected by the load-draft guard above.
      const { error: updErr } = await supabase
        .from("invoices")
        .update({ status: "emitting" })
        .eq("id", invoice_id);
      if (updErr) throw new Error(`mark-emitting: ${updErr.message}`);

      return {
        draft: draft as unknown as DraftRow,
        iva: aggregateIva(items ?? []),
        origenes: originPair ? [originPair] : [],
        channelIsFiscal: channel.is_fiscal,
        channelKind: channel.name,
      };
    });

    const draft = load.draft;

    // Branch INTERNAL: no AFIP, local numbering. The internal flow is
    // deliberately small and self-contained — it only writes to comprobantes
    // and bails. PDF generation runs after at the bottom (shared with fiscal).
    if (!load.channelIsFiscal) {
      const reservedNumero: number = await step.run(
        "reserve-and-persist-numero-internal",
        async () => {
          // B2: usa RPC atomic con advisory lock por (channel, pos, kind).
          // Reemplaza el patrón MAX(numero)+1 que tenía race condition
          // bajo emisión concurrente del mismo POS.
          const supabase = getServiceClient();
          const { data, error } = await supabase.rpc(
            "next_internal_invoice_numero_atomic",
            {
              p_invoice_id: invoice_id,
              p_channel_id: draft.channel_id,
              p_punto_venta: draft.punto_venta,
              p_kind: draft.kind,
            },
          );
          if (error)
            throw new Error(`reserve-numero-internal: ${error.message}`);
          return rpcAs<number>(data);
        },
      );

      await step.run("mark-emitted-internal", async () => {
        const supabase = getServiceClient();
        const { error: updErr } = await supabase
          .from("invoices")
          .update({
            status: "emitted",
            emitted_at: new Date().toISOString(),
          })
          .eq("id", invoice_id);
        if (updErr) throw new Error(`mark-emitted-internal: ${updErr.message}`);
      });

      await step.run("hash-pdf-internal", async () => {
        try {
          const { generateAndPersistInvoicePdfHash } = await import(
            "@/lib/pdf/generate-and-hash"
          );
          await generateAndPersistInvoicePdfHash(invoice_id);
        } catch (err) {
          logger.warn("issue_invoice.pdf_hash_failed_internal", {
            invoice_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });

      return { internal: true, cbteNro: reservedNumero };
    }

    // Fiscal branch follows.
    if (draft.cbte_tipo_afip === null) {
      throw new AfipServiceError([
        {
          code: 0,
          message:
            "Comprobante fiscal sin cbte_tipo_afip — datos inconsistentes.",
        },
      ]);
    }
    const cbteTipo = draft.cbte_tipo_afip;

    const reservedNumero: number = await step.run(
      "reserve-numero",
      async () => {
        const last = await getLastAuthorizedNumber(draft.punto_venta, cbteTipo);
        return last + 1;
      },
    );

    await step.run("persist-numero", async () => {
      const supabase = getServiceClient();
      const { error } = await supabase
        .from("invoices")
        .update({ numero: reservedNumero })
        .eq("id", invoice_id);
      if (error) throw new Error(`persist-numero: ${error.message}`);
    });

    const cae: InvoiceCAEResult = await step.run("request-cae", async () => {
      const input = buildAfipInput(load, reservedNumero);
      try {
        return await requestCAE(input);
      } catch (err) {
        if (err instanceof AfipTransportError) {
          // The request might have reached AFIP and the response was lost
          // mid-flight. Ask AFIP if it already registered this number.
          logger.info("issue_invoice.recovery_attempt", {
            invoice_id,
            ptoVta: draft.punto_venta,
            cbteTipo,
            cbteNro: reservedNumero,
          });
          const info = await getVoucherInfo(
            draft.punto_venta,
            cbteTipo,
            reservedNumero,
          );
          if (info?.cae && info.caeFchVto) {
            return {
              ptoVta: info.ptoVta,
              cbteTipo: info.cbteTipo,
              cbteNro: info.cbteNro,
              cae: info.cae,
              caeFchVto: info.caeFchVto,
              observaciones: [],
              fchProceso: null,
            };
          }
          throw err; // genuine transport failure — let Inngest retry
        }
        throw err; // service / soap-fault errors are deterministic, no retry
      }
    });

    await step.run("persist-cae", async () => {
      const supabase = getServiceClient();
      const caeFchVtoIso = `${cae.caeFchVto.slice(0, 4)}-${cae.caeFchVto.slice(4, 6)}-${cae.caeFchVto.slice(6, 8)}`;
      const { error } = await supabase
        .from("invoices")
        .update({
          cae: cae.cae,
          cae_vencimiento: caeFchVtoIso,
          status: "emitted",
          emitted_at: new Date().toISOString(),
          afip_observaciones:
            cae.observaciones.length > 0
              ? ({ obs: cae.observaciones } as never)
              : null,
        })
        .eq("id", invoice_id);
      if (error) throw new Error(`persist-cae: ${error.message}`);
    });

    // M.0: PDF hash runs after persist-cae and is best-effort. El PDF
    // se regenera on-demand desde /api/invoices/[id]/pdf; acá solo
    // calculamos y persistimos el SHA256 para tener prueba criptográfica
    // de integridad. Si falla, el comprobante sigue válido — el hash es
    // opcional.
    await step.run("hash-pdf", async () => {
      try {
        const { generateAndPersistInvoicePdfHash } = await import(
          "@/lib/pdf/generate-and-hash"
        );
        await generateAndPersistInvoicePdfHash(invoice_id);
      } catch (err) {
        logger.warn("issue_invoice.pdf_hash_failed", {
          invoice_id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return {
      cae: cae.cae,
      caeFchVto: cae.caeFchVto,
      cbteNro: reservedNumero,
    };
  },
);

async function loadOrigen(
  supabase: ReturnType<typeof getServiceClient>,
  originId: string | null,
): Promise<{ tipo: number; ptoVta: number; nro: number } | null> {
  if (!originId) return null;
  const { data, error } = await supabase
    .from("invoices")
    .select("punto_venta, cbte_tipo_afip, numero")
    .eq("id", originId)
    .maybeSingle();
  if (error) throw new Error(`load-origen: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as OriginRow;
  if (row.cbte_tipo_afip === null) return null;
  return {
    tipo: row.cbte_tipo_afip,
    ptoVta: row.punto_venta,
    nro: row.numero,
  };
}
