import "server-only";

import type { z } from "zod";

import type { PayTaxDocumentSchema } from "@/features/taxes/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Pays an open tax document through pay_tax_document, one transaction: it
 * claims the document (FOR UPDATE, so a second payment is refused), books the
 * outflow in Caja in the fiscal channel and posts it against the tax's
 * account. The caller has already checked `taxes:write` and
 * `transactions:write` and parsed the input with PayTaxDocumentSchema: the
 * «Pagar» dialog and an accepted assistant proposal.
 */
export async function payTaxDocument(
  actorId: string,
  input: z.output<typeof PayTaxDocumentSchema>,
): Promise<ActionResult<{ transactionId: string }>> {
  const { id, paid_date, account_id, amount } = input;
  const supabase = await createClient();
  const { data: transactionId, error } = await supabase.rpc(
    "pay_tax_document",
    {
      p_tax_document_id: id,
      p_paid_date: paid_date,
      p_account_id: account_id,
      p_amount: amount,
    },
  );
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.pay.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.pay.failed", { userId: actorId, id, error });
    return { ok: false, error: "No se pudo registrar el pago del impuesto." };
  }
  await logAudit(
    "tax_document.paid",
    actorId,
    { amount, transaction_id: transactionId },
    id,
  );
  return { ok: true, data: { transactionId } };
}
