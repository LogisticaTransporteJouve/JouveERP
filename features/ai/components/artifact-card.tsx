"use client";

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Pin,
  Table2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/export/csv";
import { downloadBlob } from "@/lib/export/download";
import { formatArgentineDateTime } from "@/lib/format";

import { artifactCsv, artifactXlsx } from "../artifacts/export";
import { isPlainCaption } from "../artifacts/format";
import type { Artifact, PinnableArtifact } from "../artifacts/spec";
import { usePinAiArtifact } from "../hooks/use-ai-pins";

import { ArtifactCalendar } from "./artifact-calendar";
import { ArtifactChart } from "./artifact-chart";
import { ArtifactTable } from "./artifact-table";
import { toolLabel } from "./tool-renderers";

export function exportArtifactCsv(artifact: Artifact) {
  const { fileName, csv } = artifactCsv(artifact);
  downloadCsv(fileName, csv);
}

export async function exportArtifactXlsx(artifact: Artifact) {
  try {
    // Loaded on demand: the writer stays out of the chat's bundle.
    const { buildXlsx } = await import("@/lib/export/xlsx");
    const { fileName, sheet } = artifactXlsx(artifact);
    downloadBlob(fileName, await buildXlsx(sheet));
  } catch {
    toast.error("No se pudo generar el Excel.");
  }
}

/** Flips a chart to the table of its points and back. */
export function ChartTableToggle({
  asTable,
  onToggle,
}: {
  asTable: boolean;
  onToggle: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle}>
      {asTable ? (
        <BarChart3 className="size-3.5" />
      ) : (
        <Table2 className="size-3.5" />
      )}
      {asTable ? "Gráfico" : "Tabla"}
    </Button>
  );
}

/** The chart, the month calendar, or the table of the rows (also a
 *  chart's, when toggled). */
export function ArtifactBody({
  artifact,
  asTable,
  tableMaxHeight,
}: {
  artifact: Artifact;
  asTable: boolean;
  tableMaxHeight?: string;
}) {
  if (artifact.kind === "calendar") {
    return <ArtifactCalendar artifact={artifact} maxHeight={tableMaxHeight} />;
  }
  return artifact.kind === "chart" && !asTable ? (
    <ArtifactChart artifact={artifact} />
  ) : (
    <ArtifactTable artifact={artifact} maxHeight={tableMaxHeight} />
  );
}

/** A chart, table or month calendar the assistant built from a server
 *  query: provenance line, chart/table toggle, CSV and Excel export of the
 *  rows on screen, and a slot for the pin or unpin control. */
export function ArtifactCard({
  artifact,
  control,
}: {
  artifact: Artifact;
  control?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(artifact.kind === "table");
  const Icon =
    artifact.kind === "chart"
      ? BarChart3
      : artifact.kind === "calendar"
        ? CalendarDays
        : Table2;

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
            <ChartTableToggle
              asTable={asTable}
              onToggle={() => setAsTable((v) => !v)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportArtifactCsv(artifact)}
          >
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void exportArtifactXlsx(artifact)}
          >
            <FileSpreadsheet className="size-3.5" />
            Excel
          </Button>
          {control}
        </div>
      </header>
      <ArtifactBody artifact={artifact} asTable={asTable} />
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
        {artifact.kind !== "chart" &&
          ` · ${artifact.rows.length.toLocaleString("es-AR")} filas`}
      </p>
      {meta.partial && (
        <p className="flex items-center gap-1">
          <AlertTriangle className="size-3 shrink-0" />
          Datos parciales: la consulta devolvió un resultado parcial.
        </p>
      )}
      {artifact.truncated && (
        <p className="flex items-center gap-1">
          <AlertTriangle className="size-3 shrink-0" />
          Se muestra hasta el límite de filas; hay más en la consulta.
        </p>
      )}
      {meta.note && isPlainCaption(meta.note) && <p>{meta.note}</p>}
    </div>
  );
}

/** Pins the artifact on screen: the server re-runs its query before
 *  storing it, so only the query and its config are sent. */
export function PinArtifactButton({
  artifact,
}: {
  artifact: PinnableArtifact;
}) {
  const pin = usePinAiArtifact();
  const [pinned, setPinned] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pin.isPending || pinned}
      onClick={() =>
        pin.mutate(artifact, {
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
