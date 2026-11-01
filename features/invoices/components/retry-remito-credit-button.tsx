"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/query/run-action";

import { retryRemitoCreditAction } from "../actions/bill-remito-actions";

/** Re-runs a billed remito's settlement (recibos to the fiscal side + NC
 *  interna) when it did not complete after the factura's CAE. */
export function RetryRemitoCreditButton({ facturaId }: { facturaId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      try {
        await runAction(() => retryRemitoCreditAction(facturaId));
        toast.success("Acreditación en cola.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Reintentando…" : "Reintentar acreditación"}
    </Button>
  );
}
