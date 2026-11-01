"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";
import { runAction } from "@/lib/query/run-action";

import { getArcaSyncProgressAction } from "../actions/afip-admin-actions";
import { afipAdminKeys } from "../lib/afip-admin-keys";
import { useRequestArcaSync } from "./use-afip-admin";

const POLL_MS = 3_000;
// After a click the job may take a moment to open its run row.
const START_GRACE_MS = 2 * 60 * 1000;
const TOAST_ID = "arca-sync";

/** Follows the ARCA import from the server's run record, so the progress
 *  toast and the disabled button survive reloads and other tabs. */
export function useArcaSync() {
  const request = useRequestArcaSync();
  const qc = useQueryClient();
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  const progress = useQuery({
    queryKey: afipAdminKeys.syncProgress(),
    queryFn: () => runAction(() => getArcaSyncProgressAction()),
    refetchInterval: (query) =>
      query.state.data?.running || waitingSince !== null ? POLL_MS : false,
  });

  const running = progress.data?.running ?? null;
  const sawRunning = useRef(false);
  const lastCount = useRef(-1);

  useEffect(() => {
    if (running) {
      sawRunning.current = true;
      if (waitingSince !== null) setWaitingSince(null);
      toast.loading(
        `Importando comprobantes de ARCA… ${running.imported} hasta ahora`,
        { id: TOAST_ID },
      );
      if (running.imported !== lastCount.current) {
        lastCount.current = running.imported;
        if (running.imported > 0) {
          qc.invalidateQueries({ queryKey: invoicesKeys.all });
        }
      }
      return;
    }
    if (sawRunning.current && progress.data) {
      sawRunning.current = false;
      lastCount.current = -1;
      const last = progress.data.last;
      if (last?.error) {
        toast.error(`La importación de ARCA falló: ${last.error}`, {
          id: TOAST_ID,
        });
      } else {
        toast.success(
          last && last.imported > 0
            ? `Se importaron ${last.imported} comprobantes de ARCA.`
            : "No había comprobantes nuevos en ARCA.",
          { id: TOAST_ID },
        );
      }
      qc.invalidateQueries({ queryKey: invoicesKeys.all });
      return;
    }
    if (waitingSince !== null && Date.now() - waitingSince > START_GRACE_MS) {
      setWaitingSince(null);
      toast.error("La importación no arrancó. Probá de nuevo en un rato.", {
        id: TOAST_ID,
      });
    }
  }, [running, progress.data, waitingSince, qc]);

  function start() {
    request.mutate(undefined, {
      onError: (err) => toast.error(err.message),
      onSuccess: () => {
        setWaitingSince(Date.now());
        toast.loading("Importando comprobantes de ARCA…", { id: TOAST_ID });
        void progress.refetch();
      },
    });
  }

  return {
    start,
    busy: request.isPending || running !== null || waitingSince !== null,
  };
}
