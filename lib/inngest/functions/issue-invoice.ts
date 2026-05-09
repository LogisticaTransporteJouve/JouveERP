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
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  INVOICE_ISSUE_REQUESTED,
  InvoiceIssueRequestedSchema,
} from "../events";

// `issueInvoice` orchestrates the durable emission flow for fiscal
// comprobantes. The steps are intentionally fine-grained so an Inngest
// retry never re-pays AFIP for work it already did:
//
//   load-draft       → snapshot the row (status flips draft → emitting)
//   reserve-numero   → ask AFIP for the last authorized number for the POS
//   persist-numero   → store number on the row before requesting the CAE,
//                      so a crashed retry can recover via FECompConsultar
//   request-cae      → call FECAESolicitar; on transport error, ask AFIP
//                      "did you actually register this number?" before
//                      letting Inngest retry. If AFIP did, adopt that CAE.
//   persist-cae      → store CAE + flip status to emitted.
//
// Idempotency is event-level (`event.data.idempotency_key`) so duplicate
// dispatches don't trigger duplicate runs. The DB also enforces uniqueness
// on `idempotency_key` so duplicate drafts can't be created.
//
// PDF + notification land in E.5 (a separate function chained from this
// one) so Phase E ships incrementally.

const RETRYABLE_LIMIT = 5;

type DraftRow = {
  id: string;
  channel_id: string;
  client_id: string;
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
  comprobante_origen_id: string | null;
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

type DraftLoad = {
  draft: DraftRow;
  iva: InvoiceIvaEntry[];
  origenes: Array<{ tipo: number; ptoVta: number; nro: number }>;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
        comprobante_id: parsed.data.comprobante_id,
        err: error.message,
      });
      await supabase
        .from("comprobantes")
        .update({
          status: "failed",
          afip_observaciones: { error: error.message } as never,
        })
        .eq("id", parsed.data.comprobante_id);
    },
  },
  async ({ event, step }) => {
    const parsed = InvoiceIssueRequestedSchema.parse(event.data);
    const { comprobante_id } = parsed;

    const load: DraftLoad = await step.run("load-draft", async () => {
      const supabase = getServiceClient();
      const { data: draft, error } = await supabase
        .from("comprobantes")
        .select("*")
        .eq("id", comprobante_id)
        .maybeSingle();
      if (error) throw new Error(`load-draft: ${error.message}`);
      if (!draft) throw new Error(`Comprobante ${comprobante_id} no existe.`);
      if (draft.status !== "draft" && draft.status !== "emitting") {
        throw new Error(
          `Comprobante ${comprobante_id} en estado ${draft.status} — no se puede emitir.`,
        );
      }

      const [{ data: items, error: itemsErr }, originPair] = await Promise.all([
        supabase
          .from("comprobante_items")
          .select("iva_rate_id, line_neto, line_iva")
          .eq("comprobante_id", comprobante_id),
        loadOrigen(supabase, draft.comprobante_origen_id),
      ]);
      if (itemsErr) throw new Error(`load-items: ${itemsErr.message}`);

      // Flip status to emitting so duplicate clicks that bypass Inngest's
      // dedupe still get rejected by the load-draft guard above.
      const { error: updErr } = await supabase
        .from("comprobantes")
        .update({ status: "emitting" })
        .eq("id", comprobante_id);
      if (updErr) throw new Error(`mark-emitting: ${updErr.message}`);

      return {
        draft: draft as unknown as DraftRow,
        iva: aggregateIva(items ?? []),
        origenes: originPair ? [originPair] : [],
      };
    });

    const draft = load.draft;
    if (draft.cbte_tipo_afip === null) {
      throw new AfipServiceError([
        {
          code: 0,
          message: "Falta cbte_tipo_afip — interno aún no soportado en E.4.",
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
        .from("comprobantes")
        .update({ numero: reservedNumero })
        .eq("id", comprobante_id);
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
            comprobante_id,
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
        .from("comprobantes")
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
        .eq("id", comprobante_id);
      if (error) throw new Error(`persist-cae: ${error.message}`);
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
    .from("comprobantes")
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
