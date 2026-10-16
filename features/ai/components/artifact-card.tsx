"use client";

import { AlertTriangle, BarChart3, Download, Pin, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/export/csv";
import { formatArgentineDateTime } from "@/lib/format";

import { artifactCsv } from "../artifacts/export";
import { pinRequestOf, type Artifact } from "../artifacts/spec";
import { usePinAiArtifact } from "../hooks/use-ai-pins";

import { ArtifactChart } from "./artifact-chart";
import { ArtifactTable } from "./artifact-table";
import { toolLabel } from "./tool-renderers";

/** A chart or table the assistant built from a server query: provenance
 *  line, chart/table toggle, CSV export of the rows on screen, and a slot
 *  for the pin or unpin control. */
export function ArtifactCard({
  artifact,
  control,
}: {
  artifact: Artifact;
  control?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(artifact.kind === "table");
  const Icon = artifact.kind === "chart" ? BarChart3 : Table2;

  function exportCsv() {
    const { fileName, csv } = artifactCsv(artifact);
    downloadCsv(fileName, csv);
  }

  return (
    <section className="bg-card w-full space-y-3 rounded-lg border p-3">
      <header className="flex flex-wrap items-start gap-2">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{artifact.title}</h3>
          <ArtifactProvenance artifact={artifact} />
        </div>
        <div className="flex items-center gap-1">
          {artifact.kind === "chart" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAsTable((v) => !v)}
            >
              {asTable ? (
                <BarChart3 className="size-3.5" />
              ) : (
                <Table2 className="size-3.5" />
              )}
              {asTable ? "Gráfico" : "Tabla"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <Download className="size-3.5" />
            CSV
          </Button>
          {control}
        </div>
      </header>
      {artifact.kind === "chart" && !asTable ? (
        <ArtifactChart artifact={artifact} />
      ) : (
        <ArtifactTable artifact={artifact} />
      )}
    </section>
  );
}

export function ArtifactProvenance({ artifact }: { artifact: Artifact }) {
  const { meta } = artifact;
  return (
    <div className="text-muted-foreground space-y-0.5 text-xs">
      <p title={meta.sources.join(", ")}>
        {toolLabel(artifact.source.action)} · al{" "}
        {formatArgentineDateTime(meta.asOf)}
        {artifact.kind === "table" &&
          ` · ${artifact.rows.length.toLocaleString("es-AR")} filas`}
      </p>
      {meta.partial && (
        <p className="flex items-center gap-1">
          <AlertTriangle className="size-3 shrink-0" />
          Datos parciales
          {artifact.truncated
            ? ": se muestra hasta el límite de filas."
            : ": la consulta devolvió un resultado parcial."}
        </p>
      )}
      {meta.note && <p>{meta.note}</p>}
    </div>
  );
}

/** Pins the artifact on screen: the server re-runs its query before
 *  storing it, so only the query and its config are sent. */
export function PinArtifactButton({ artifact }: { artifact: Artifact }) {
  const pin = usePinAiArtifact();
  const [pinned, setPinned] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pin.isPending || pinned}
      onClick={() =>
        pin.mutate(pinRequestOf(artifact), {
          onSuccess: () => {
            setPinned(true);
            toast.success("Fijado. Lo ves en Fijados de IA.");
          },
          onError: (err) =>
            toast.error(
              err instanceof Error ? err.message : "No se pudo fijar.",
            ),
        })
      }
    >
      <Pin className="size-3.5" />
      {pinned ? "Fijado" : "Fijar"}
    </Button>
  );
}
