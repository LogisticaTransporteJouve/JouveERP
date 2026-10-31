"use client";

import { CloudDownload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useRequestArcaSync } from "../hooks/use-afip-admin";

export function ArcaSyncButton() {
  const sync = useRequestArcaSync();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={sync.isPending}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: () =>
            toast.success(
              "Importando comprobantes de ARCA. Van a aparecer en unos minutos.",
            ),
          onError: (err) => toast.error(err.message),
        })
      }
    >
      <CloudDownload />
      {sync.isPending ? "Iniciando…" : "Traer de ARCA"}
    </Button>
  );
}
