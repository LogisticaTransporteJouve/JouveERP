"use client";

import { useActionQuery } from "@/hooks/use-action-query";

import { getNextReceiptNumeroAction } from "../actions/receipts-actions";

/**
 * Suggests the next receipt number for the given channel. The "first ever"
 * flag lets the form unlock the input so the user can override the starting
 * value when migrating from a prior numbering system.
 */
export function useNextReceiptNumero(channelId: string | null) {
  const query = useActionQuery(
    ["receipts", "next-numero", channelId ?? "_none"],
    () =>
      getNextReceiptNumeroAction({
        channel_id: channelId ?? "",
        // POS is resolved server-side from the channel, but the action
        // signature still requires the param — see receipts-actions.ts.
        punto_venta: 0,
      }),
    { enabled: !!channelId },
  );

  return {
    next: query.data?.next ?? null,
    isFirst: query.data?.isFirst ?? false,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
