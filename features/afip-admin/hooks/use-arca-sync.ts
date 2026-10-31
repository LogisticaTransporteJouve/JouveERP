"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";

import { countArcaImportedSinceAction } from "../actions/afip-admin-actions";
import { useRequestArcaSync } from "./use-afip-admin";

const POLL_MS = 3_000;
// The job reports nothing back; once the count stops moving for this many
// polls (~1 min) the import is taken as finished.
const IDLE_POLLS = 20;

/** Queues the ARCA import and keeps one toast updated with how many
 *  vouchers have landed so far. */
export function useArcaSync() {
  const request = useRequestArcaSync();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    request.mutate(undefined, {
      onError: (err) => toast.error(err.message),
      onSuccess: ({ requestedAt }) => {
        const toastId = toast.loading("Importando comprobantes de ARCA…");
        let last = -1;
        let idle = 0;
        setRunning(true);
        timer.current = setInterval(async () => {
          const res = await countArcaImportedSinceAction(requestedAt);
          if (!res.ok) {
            stop();
            toast.error(res.error, { id: toastId });
            return;
          }
          const count = res.data;
          if (count !== last) {
            last = count;
            idle = 0;
            toast.loading(
              `Importando comprobantes de ARCA… ${count} hasta ahora`,
              { id: toastId },
            );
            if (count > 0) qc.invalidateQueries({ queryKey: invoicesKeys.all });
            return;
          }
          idle += 1;
          if (idle < IDLE_POLLS) return;
          stop();
          toast.success(
            count > 0
              ? `Se importaron ${count} comprobantes de ARCA.`
              : "No había comprobantes nuevos en ARCA.",
            { id: toastId },
          );
        }, POLL_MS);
      },
    });
  }, [qc, request, stop]);

  return { start, busy: request.isPending || running };
}
