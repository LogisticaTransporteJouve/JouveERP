import "server-only";

import { logger } from "@/lib/logger";
import type { getServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof getServiceClient>;

/** Frees a liquidación claimed for invoicing that ended up with no invoice
 *  (a failed issue, or an invoice that already failed). A release that
 *  fails is logged: the claim then expires on its own (CLAIM_TTL_MS). */
export async function releaseInvoicingClaim(
  supabase: Service,
  settlementId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("freight_settlements")
    .update({ invoicing_claimed_at: null })
    .eq("id", settlementId)
    .is("invoice_id", null);
  if (error) {
    logger.error("freight_settlements.invoice.release_failed", {
      userId,
      id: settlementId,
      error,
    });
  }
}
