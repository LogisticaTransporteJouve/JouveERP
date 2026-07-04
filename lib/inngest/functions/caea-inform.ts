import { type CaeaCodeRow } from "@/lib/afip/caea";
import { toAfipDateTimeAR } from "@/lib/afip/caea-periods";
import { AfipServiceError, AfipTransportError } from "@/lib/afip/errors";
import {
  CAEA_NO_MOVEMENT_ALREADY_INFORMED,
  informCaeaNoMovement,
  informCaeaVoucher,
} from "@/lib/afip/wsfev1";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

import {
  aggregateIva,
  buildAfipInput,
  type DraftLoad,
  type DraftRow,
  type ItemRow,
} from "./issue-invoice";

// Régimen informativo CAEA: reporta a AFIP los comprobantes emitidos offline
// (FECAEARegInformativo) y declara "sin movimiento" los PV de contingencia
// que no emitieron nada bajo un CAEA ya vencido. Corre a diario — el deadline
// es fch_tope_inf (~8 días corridos después del fin de la quincena) y llegar
// tarde acumula la observación 15014 en futuras solicitudes.

const PENDING_LIMIT = 200;

type PendingCaeaInvoice = DraftRow & {
  numero: number;
  cae: string;
  cbte_fch_hs_gen: string | null;
};

/** 702–704: numeración/fecha ya registrada — el comprobante ya fue informado. */
const ALREADY_INFORMED_CODES = new Set([702, 703, 704]);

export const caeaInform = inngest.createFunction(
  {
    id: "caea-inform",
    name: "CAEA — régimen informativo (comprobantes + sin movimiento)",
    retries: 3,
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 15 8 * * *" }],
  },
  async ({ step }) => {
    const supabase = getServiceClient();

    // -- 1. Comprobantes emitidos bajo CAEA pendientes de informar -----------
    const pending = await step.run("load-pending", async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("emission_type", "caea")
        .is("caea_informed_at", null)
        .eq("status", "emitted")
        .not("numero", "is", null)
        .order("punto_venta")
        .order("cbte_tipo_afip")
        .order("numero")
        .limit(PENDING_LIMIT);
      if (error) throw new Error(`load-pending: ${error.message}`);
      return (data ?? []) as unknown as PendingCaeaInvoice[];
    });

    let informed = 0;
    const rejected: { invoice_id: string; error: string }[] = [];

    for (const inv of pending) {
      const done = await step.run(`inform-${inv.id}`, async () => {
        const { data: items, error: itemsErr } = await supabase
          .from("invoice_items")
          .select("iva_rate_id, line_neto, line_iva")
          .eq("invoice_id", inv.id);
        if (itemsErr) throw new Error(`load-items: ${itemsErr.message}`);

        const load: DraftLoad = {
          draft: inv,
          iva: aggregateIva((items ?? []) as ItemRow[]),
          origenes: [],
          channelIsFiscal: true,
          channelKind: "",
          posEmissionType: "CAEA",
        };
        try {
          await informCaeaVoucher({
            ...buildAfipInput(load, inv.numero),
            caea: inv.cae,
            cbteFchHsGen: toAfipDateTimeAR(
              inv.cbte_fch_hs_gen ?? new Date().toISOString(),
            ),
          });
          return { informed: true as const };
        } catch (err) {
          if (
            err instanceof AfipServiceError &&
            err.errors.some((e) => ALREADY_INFORMED_CODES.has(e.code))
          ) {
            // Un retry anterior llegó a AFIP — tomarlo como informado.
            return { informed: true as const };
          }
          if (err instanceof AfipTransportError) throw err; // retry del cron
          logger.warn("caea.inform.rejected", {
            invoice_id: inv.id,
            err: err instanceof Error ? err.message : String(err),
          });
          return {
            informed: false as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });

      if (done.informed) {
        await step.run(`mark-informed-${inv.id}`, async () => {
          const { error } = await supabase
            .from("invoices")
            .update({ caea_informed_at: new Date().toISOString() })
            .eq("id", inv.id);
          if (error) throw new Error(`mark-informed: ${error.message}`);
        });
        informed += 1;
      } else {
        rejected.push({ invoice_id: inv.id, error: done.error ?? "?" });
      }
    }

    // -- 2. Sin movimiento: CAEA vencidos con PVs de contingencia sin uso ----
    const noMovement = await step.run("inform-no-movement", async () => {
      const today = todayInAR();
      const { data: expired, error } = await supabase
        .from("caea_codes")
        .select("*")
        .lt("fch_vig_hasta", today)
        .gte("fch_tope_inf", today);
      if (error) throw new Error(`load-expired-caea: ${error.message}`);

      const { data: pos } = await supabase
        .from("sales_points")
        .select("numero, last_known_emission_type, is_enabled")
        .eq("is_enabled", true);
      const caeaPvs = (pos ?? [])
        .filter((p) =>
          (p.last_known_emission_type ?? "").toUpperCase().includes("CAEA"),
        )
        .map((p) => p.numero);

      let declared = 0;
      for (const code of (expired ?? []) as CaeaCodeRow[]) {
        const alreadyDone = new Set(
          Array.isArray(code.no_movement_pvs)
            ? (code.no_movement_pvs as number[])
            : [],
        );
        const { data: used } = await supabase
          .from("invoices")
          .select("punto_venta")
          .eq("emission_type", "caea")
          .eq("cae", code.caea);
        const usedPvs = new Set((used ?? []).map((u) => u.punto_venta));

        for (const pv of caeaPvs) {
          if (alreadyDone.has(pv) || usedPvs.has(pv)) continue;
          try {
            await informCaeaNoMovement(pv, code.caea);
          } catch (err) {
            const idempotent =
              err instanceof AfipServiceError &&
              err.errors.some(
                (e) => e.code === CAEA_NO_MOVEMENT_ALREADY_INFORMED,
              );
            if (!idempotent) {
              logger.warn("caea.no_movement.failed", {
                caea: code.caea,
                pv,
                err: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
          alreadyDone.add(pv);
          declared += 1;
          await supabase
            .from("caea_codes")
            .update({ no_movement_pvs: [...alreadyDone] })
            .eq("id", code.id);
        }
      }
      return declared;
    });

    return { informed, rejected, noMovement };
  },
);
