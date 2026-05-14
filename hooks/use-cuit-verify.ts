"use client";

import { useCallback, useState } from "react";

import { verifyCuitAction } from "@/features/clients/actions/afip-actions";
import type { ContributorInfo } from "@/lib/afip/types";

// Hook genérico para "Verificar AFIP" reutilizado por clientes y proveedores.
// La diferencia entre ambos contextos es solamente cuál tabla local revisar
// para detectar duplicados por CUIT — eso se inyecta vía `findByCuit`.
//
// El RPC del padrón AFIP (`verifyCuitAction`) es el mismo en ambos casos:
// hace lookup en `padron_cache`, fallback a AFIP, rate-limit 60/h, cache 24h.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type CuitVerifyResult<T> =
  | { kind: "existing"; entity: T }
  | {
      kind: "verified";
      data: ContributorInfo;
      fromCache: boolean;
      stale?: boolean;
    }
  | { kind: "error"; error: string };

export function useCuitVerify<T extends { id: string }>(options: {
  findByCuit: (cuit: string) => Promise<ActionResult<T | null>>;
}) {
  const [isVerifying, setIsVerifying] = useState(false);

  const verify = useCallback(
    async (
      cuit: string,
      currentEntityId?: string,
    ): Promise<CuitVerifyResult<T> | null> => {
      const trimmed = cuit.trim();
      if (!trimmed) return null;

      setIsVerifying(true);
      try {
        const existing = await options.findByCuit(trimmed);
        if (
          existing.ok &&
          existing.data &&
          existing.data.id !== currentEntityId
        ) {
          return { kind: "existing", entity: existing.data };
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
    [options],
  );

  return { verify, isVerifying };
}
