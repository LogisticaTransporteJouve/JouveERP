"use client";

import { CloudDownload } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useArcaSync } from "../hooks/use-arca-sync";

export function ArcaSyncButton() {
  const sync = useArcaSync();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={sync.busy}
      onClick={sync.start}
    >
      <CloudDownload />
      {sync.busy ? "Importando…" : "Traer de ARCA"}
    </Button>
  );
}
