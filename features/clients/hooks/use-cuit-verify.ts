"use client";

import { useCallback, useState } from "react";

import type { ContributorInfo } from "@/lib/afip/types";

import { verifyCuitAction } from "../actions/afip-actions";
import { findClientByCuitAction } from "../actions/clients-actions";
import type { Client } from "../schema";

/**
 * Encapsulates the "Verificar AFIP" flow used by the client form.
 *
 * Flow:
 *   1. Look up the local clients table by CUIT (`findClientByCuitAction`).
 *      If a different row already owns the CUIT, return `existing` so the
 *      caller can offer a link to that client and short-circuit.
 *   2. Otherwise call `verifyCuitAction` (rate-limited 60/h, 24h cache,
 *      stale fallback) and return the AFIP `ContributorInfo`.
 */
export type CuitVerifyResult =
  | { kind: "existing"; client: Client }
  | { kind: "verified"; data: ContributorInfo; fromCache: boolean; stale?: boolean }
  | { kind: "error"; error: string };

export function useCuitVerify() {
  const [isVerifying, setIsVerifying] = useState(false);

  const verify = useCallback(
    async (
      cuit: string,
      currentClientId?: string,
    ): Promise<CuitVerifyResult | null> => {
      const trimmed = cuit.trim();
      if (!trimmed) return null;

      setIsVerifying(true);
      try {
        const existing = await findClientByCuitAction(trimmed);
        if (
          existing.ok &&
          existing.data &&
          existing.data.id !== currentClientId
        ) {
          return { kind: "existing", client: existing.data };
        }

        const result = await verifyCuitAction({ cuit: trimmed });
        if (!result.ok) {
          return { kind: "error", error: result.error };
        }

        return {
          kind: "verified",
          data: result.data,
          fromCache: result.fromCache,
          stale: result.stale,
        };
      } finally {
        setIsVerifying(false);
      }
    },
    [],
  );

  return { verify, isVerifying };
}
