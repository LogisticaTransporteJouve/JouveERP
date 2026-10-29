import { NonRetriableError } from "inngest";

import { getActiveCaeaForDate } from "@/lib/afip/caea";
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
import { reserveNumberAndRequestCae } from "./issue-invoice-cae";

// `issueInvoice` orchestrates the durable emission flow for comprobantes.
// Branches on `channel.is_fiscal` and, for fiscal, on the POS emission type:
//
// FISCAL (AFIP):
//   load-draft       → snapshot the row + channel (status flips draft → emitting)
//   reserve-numero-and-request-cae → ONE step: last authorized number + 1,
//                      recorded in afip_attempted_numero, then FECAESolicitar.
//                      Recovers a lost response via FECompConsultar, adopting
//                      the CAE only if the voucher matches this invoice. See
//                      issue-invoice-cae.ts for why it must be a single step.
//   persist-cae      → store numero + CAE + flip status to emitted.
//   generate-pdf     → render fiscal PDF (CAE + QR).
//
// CAEA (contingency punto de venta):
//   load-active-caea → the fortnight code covering the voucher date.
//   emit-caea        → number + CAEA + emitted in one RPC; informed later by
//                      the caea-inform cron.
//
// INTERNAL (no AFIP):
//   load-draft       → idem.
//   reserve-and-persist-numero-internal → max(numero) + 1 over the same
//                      (channel_id, punto_venta, kind) tuple, in one RPC under
//                      an advisory lock; a retry gets the number back.
//   mark-emitted     → flip status to emitted (no CAE, no QR).
//   generate-pdf     → render the "Documento no fiscal" PDF.
//
// Idempotency is event-level (`event.data.idempotency_key`) so duplicate
// dispatches don't trigger duplicate runs. The DB also enforces uniqueness
// on `idempotency_key` so duplicate drafts can't be created.

const RETRYABLE_LIMIT = 5;

export type DraftRow = {
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

export type ItemRow = {
  iva_rate_id: number | null;
  line_neto: string | number;
  line_iva: string | number;
};

type OriginRow = {
  punto_venta: number;
  cbte_tipo_afip: number | null;
  numero: number;
};

/** Shape of the `channel:invoicing_channels(id, is_fiscal, name)` join embedded
 *  in the draft when read with an expanded select in issue-invoice. */
type DraftChannelJoin = {
  channel: { id: string; is_fiscal: boolean; name: string } | null;
};

export type DraftLoad = {
  draft: DraftRow;
  iva: InvoiceIvaEntry[];
  origenes: Array<{ tipo: number; ptoVta: number; nro: number }>;
  channelIsFiscal: boolean;
  channelKind: string;
  /** AFIP EmisionTipo of the POS ("CAE" | "CAEA" | null if never synced). */
  posEmissionType: string | null;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

export function aggregateIva(items: ItemRow[]): InvoiceIvaEntry[] {
  const buckets = new Map<number, { base: number; importe: number }>();
  for (const item of items) {
    if (item.iva_rate_id === null) continue;
    const base = round2(toNumber(item.line_neto));
    const amount = round2(toNumber(item.line_iva));
    const bucket = buckets.get(item.iva_rate_id) ?? { base: 0, importe: 0 };
    bucket.base = round2(bucket.base + base);
    bucket.importe = round2(bucket.importe + amount);
    buckets.set(item.iva_rate_id, bucket);
  }
  const out: InvoiceIvaEntry[] = [];
  for (const [id, b] of buckets) {
    out.push({ id: id as IvaRateId, baseImp: b.base, importe: b.importe });
  }
  return out;
}

export function buildAfipInput(
  load: DraftLoad,
  cbteNro: number,
): InvoiceRequestInput {
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
    // One step at a time per punto de venta. Inngest limits concurrent STEPS
    // per key (not whole runs), which is exactly what the fiscal branch needs:
    // reading AFIP's last number and requesting the CAE happen inside one
    // step. Keyed by punto de venta alone because AFIP numbers per (CUIT,
    // punto de venta, tipo): two channels sharing a punto de venta share the
    // sequence. The internal and CAEA branches number atomically on their own.
    concurrency: {
      key: "string(event.data.punto_venta)",
      limit: 1,
    },
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
        .eq("id", parsed.data.invoice_id)
        // A voucher that already got its CAE (or internal number) stays
        // emitted: only a pending emission fails.
        .in("status", ["draft", "emitting"]);
    },
  },
  async ({ event, step }) => {
    const parsed = InvoiceIssueRequestedSchema.parse(event.data);
    const { invoice_id } = parsed;

    const load: DraftLoad = await step.run("load-draft", async () => {
      const supabase = getServiceClient();
      const { data: draft, error } = await supabase
        .from("invoices")
        .select("*, channel:invoicing_channels(id, is_fiscal, name)")
        .eq("id", invoice_id)
        .maybeSingle();
      if (error) throw new Error(`load-draft: ${error.message}`);
      if (!draft) throw new Error(`Invoice ${invoice_id} does not exist.`);
      if (draft.status !== "draft" && draft.status !== "emitting") {
        throw new Error(
          `Comprobante ${invoice_id} en estado ${draft.status} — no se puede emitir.`,
        );
      }

      const channel = (draft as unknown as DraftChannelJoin).channel;
      if (!channel) {
        throw new Error(`Comprobante ${invoice_id} — canal no encontrado.`);
      }

      const [{ data: items, error: itemsErr }, originPair, posRes] =
        await Promise.all([
          supabase
            .from("invoice_items")
            .select("iva_rate_id, line_neto, line_iva")
            .eq("invoice_id", invoice_id),
          loadOrigen(supabase, draft.invoice_origin_id),
          supabase
            .from("sales_points")
            .select("last_known_emission_type")
            .eq("numero", draft.punto_venta)
            .maybeSingle(),
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
        posEmissionType: posRes.data?.last_known_emission_type ?? null,
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
          const { generateAndPersistInvoicePdfHash } =
            await import("@/lib/pdf/generate-and-hash");
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
    // Deterministic: a retry replays the same data and keeps the invoice in
    // "emitting" for the whole retry schedule.
    if (draft.cbte_tipo_afip === null) {
      throw new NonRetriableError(
        "Comprobante fiscal sin cbte_tipo_afip — datos inconsistentes.",
      );
    }
    const cbteTipo = draft.cbte_tipo_afip;

    // Branch CAEA (contingencia): the POS is registered in ARCA's ABM with
    // EmisionTipo CAEA. No FECAESolicitar — the voucher goes out offline with
    // the fortnight's pre-granted code and its own gapless numbering; the
    // caea-inform cron reports it to AFIP afterwards (FECAEARegInformativo).
    if (load.posEmissionType?.toUpperCase().includes("CAEA")) {
      const caea = await step.run("load-active-caea", async () => {
        // The CAEA must cover the voucher's date (CbteFch), not the run's.
        const active = await getActiveCaeaForDate(draft.fecha);
        if (!active) {
          throw new NonRetriableError(
            "No hay CAEA vigente para la fecha del comprobante — solicitalo desde AFIP admin antes de emitir por contingencia.",
          );
        }
        return active;
      });

      const caeaNumero: number = await step.run("emit-caea", async () => {
        // Local numbering: AFIP only knows CAEA numbers once informed, so
        // the floor is max(local, último informado en AFIP). The RPC numbers
        // the voucher and marks it emitted in one locked transaction.
        let afipLast = 0;
        try {
          afipLast = await getLastAuthorizedNumber(draft.punto_venta, cbteTipo);
        } catch {
          // AFIP caído — exactamente el escenario CAEA. Seguimos con lo local.
        }
        const supabase = getServiceClient();
        const { data, error } = await supabase.rpc("emit_caea_invoice", {
          p_invoice_id: invoice_id,
          p_afip_last: afipLast,
          p_caea: caea.caea,
          p_cae_vencimiento: caea.fch_vig_hasta,
        });
        if (error) throw new Error(`emit-caea: ${error.message}`);
        return rpcAs<number>(data);
      });

      await step.run("hash-pdf-caea", async () => {
        try {
          const { generateAndPersistInvoicePdfHash } =
            await import("@/lib/pdf/generate-and-hash");
          await generateAndPersistInvoicePdfHash(invoice_id);
        } catch (err) {
          logger.warn("issue_invoice.pdf_hash_failed_caea", {
            invoice_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });

      return { caea: caea.caea, cbteNro: caeaNumero };
    }

    // `numero` is written only together with the CAE (persist-cae): a failed
    // emission must leave it null so the slot stays free. Persisting it
    // up-front poisoned the POS — a rejected invoice held the number and every
    // later emission collided with the unique index. The attempted number is
    // kept in afip_attempted_numero instead (recovery input, not unique).
    const cae: InvoiceCAEResult = await step.run(
      "reserve-numero-and-request-cae",
      async () => {
        const supabase = getServiceClient();
        return reserveNumberAndRequestCae({
          invoiceId: invoice_id,
          ptoVta: draft.punto_venta,
          cbteTipo,
          expected: {
            impTotal: toNumber(draft.imp_total),
            fecha: draft.fecha,
            docTipo: draft.doc_tipo,
            docNro: draft.doc_nro,
          },
          buildInput: (cbteNro) => buildAfipInput(load, cbteNro),
          afip: { getLastAuthorizedNumber, requestCAE, getVoucherInfo },
          attempts: {
            read: async () => {
              const { data, error } = await supabase
                .from("invoices")
                .select("afip_attempted_numero")
                .eq("id", invoice_id)
                .maybeSingle();
              if (error) throw new Error(`read-attempt: ${error.message}`);
              return data?.afip_attempted_numero ?? null;
            },
            record: async (cbteNro) => {
              const { error } = await supabase
                .from("invoices")
                .update({ afip_attempted_numero: cbteNro })
                .eq("id", invoice_id);
              if (error) throw new Error(`record-attempt: ${error.message}`);
            },
            takenByOther: async (cbteNro) => {
              const { data, error } = await supabase
                .from("invoices")
                .select("id")
                .eq("punto_venta", draft.punto_venta)
                .eq("cbte_tipo_afip", cbteTipo)
                .neq("id", invoice_id)
                .neq("status", "failed")
                .or(`numero.eq.${cbteNro},afip_attempted_numero.eq.${cbteNro}`)
                .limit(1);
              if (error) throw new Error(`check-attempt: ${error.message}`);
              return (data ?? []).length > 0;
            },
          },
        });
      },
    );

    await step.run("persist-cae", async () => {
      const supabase = getServiceClient();
      const caeFchVtoIso = `${cae.caeFchVto.slice(0, 4)}-${cae.caeFchVto.slice(4, 6)}-${cae.caeFchVto.slice(6, 8)}`;
      const { error } = await supabase
        .from("invoices")
        .update({
          numero: cae.cbteNro,
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

    // M.0: PDF hash runs after persist-cae and is best-effort. The PDF
    // is regenerated on-demand from /api/invoices/[id]/pdf; here we only
    // compute and persist the SHA256 to have cryptographic proof of
    // integrity. If it fails, the comprobante stays valid — the hash is
    // optional.
    await step.run("hash-pdf", async () => {
      try {
        const { generateAndPersistInvoicePdfHash } =
          await import("@/lib/pdf/generate-and-hash");
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
      cbteNro: cae.cbteNro,
    };
  },
);

export async function loadOrigen(
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
