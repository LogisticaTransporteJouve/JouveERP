import "server-only";

import type { z } from "zod";

import type { TaxDocumentCreateSchema } from "@/features/taxes/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export const DUPLICATE_TAX_DOCUMENT =
  "Ya hay un impuesto de ese tipo y período (con la misma jurisdicción y nombre). Editá el existente o anulalo.";

/**
 * Loads a tax document (an obligation with its due date and, if known, its
 * amount) and audits it. The caller has already checked `taxes:write` and
 * parsed the input with TaxDocumentCreateSchema: the Impuestos dialog and an
 * accepted assistant proposal. It writes with the user's session client, as
 * the dialog always did: RLS on tax_documents applies.
 */
export async function createTaxDocument(
  actorId: string,
  d: z.output<typeof TaxDocumentCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_documents")
    .insert({
      kind: d.kind,
      title: d.title,
      jurisdiction: d.jurisdiction,
      period: d.period,
      due_date: d.due_date,
      amount: d.amount,
      amount_is_estimate: d.amount_is_estimate,
      account_id: d.account_id,
      credit_balance: d.credit_balance,
      notes: d.notes,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_TAX_DOCUMENT };
    }
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo cargar el impuesto." };
  }
  await logAudit(
    "tax_document.created",
    actorId,
    { kind: d.kind, period: d.period, estimate: d.amount_is_estimate },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
