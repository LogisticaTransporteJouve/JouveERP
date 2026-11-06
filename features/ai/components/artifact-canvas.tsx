"use client";

import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Component, useState, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Artifact } from "../artifacts/spec";
import type { ArtifactEntry, ArtifactKind } from "../lib/artifact-canvas";

import {
  ArtifactBody,
  ArtifactProvenance,
  ChartTableToggle,
  PinArtifactButton,
  exportArtifactCsv,
  exportArtifactXlsx,
} from "./artifact-card";

const KIND_LABEL: Record<ArtifactKind, string> = {
  chart: "Gráfico",
  table: "Tabla",
  calendar: "Calendario",
};

/** Each kind with its article, for «No se pudo armar …». */
const KIND_NOUN: Record<ArtifactKind, string> = {
  chart: "el gráfico",
  table: "la tabla",
  calendar: "el calendario",
};

const KIND_ICON = {
  chart: BarChart3,
  table: Table2,
  calendar: CalendarDays,
} as const;

/**
 * The right side of the assistant: the one artifact the chat has open, with
 * pin, export and close. Beside the chat from `lg`; on a narrow screen it
 * covers the chat, with a way back to it.
 */
export function ArtifactCanvas({
  entry,
  onClose,
}: {
  entry: ArtifactEntry;
  onClose: () => void;
}) {
  const label = KIND_LABEL[entry.kind];
  const Icon = KIND_ICON[entry.kind];
  return (
    <aside
      aria-label={label}
      className="bg-card absolute inset-0 z-10 flex flex-col rounded-lg border lg:static lg:z-auto lg:min-w-0 lg:flex-1"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={onClose}
        >
          <ArrowLeft className="size-4" />
          Volver al chat
        </Button>
        <span className="text-muted-foreground hidden items-center gap-1.5 px-1 text-sm font-medium lg:flex">
          <Icon className="size-4" />
          {label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {entry.status === "ready" && (
            <>
              {/* A pin rebuilds charts and tables only. */}
              {entry.artifact.kind !== "calendar" && (
                <PinArtifactButton key={entry.id} artifact={entry.artifact} />
              )}
              <ExportMenu artifact={entry.artifact} />
            </>
          )}
          <IconButton
            label="Cerrar"
            variant="ghost"
            className="hidden size-8 lg:inline-flex"
            onClick={onClose}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-5 lg:px-6">
        <CanvasErrorBoundary key={entry.id}>
          <CanvasBody entry={entry} />
        </CanvasErrorBoundary>
      </div>
    </aside>
  );
}

function CanvasBody({ entry }: { entry: ArtifactEntry }) {
  if (entry.status === "building") {
    return (
      <div
        className="space-y-3"
        role="status"
        aria-label={`Armando ${KIND_LABEL[entry.kind].toLowerCase()}…`}
      >
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <CanvasMessage>
        No se pudo armar {KIND_NOUN[entry.kind]}. Pedíselo de nuevo al
        asistente.
      </CanvasMessage>
    );
  }
  return <ReadyArtifact key={entry.id} artifact={entry.artifact} />;
}

function ReadyArtifact({ artifact }: { artifact: Artifact }) {
  const [asTable, setAsTable] = useState(artifact.kind === "table");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold">{artifact.title}</h2>
          <ArtifactProvenance artifact={artifact} />
        </div>
        {artifact.kind === "chart" && (
          <ChartTableToggle
            asTable={asTable}
            onToggle={() => setAsTable((v) => !v)}
          />
        )}
      </div>
      {/* The canvas scrolls; the table or calendar needs no box of its own. */}
      <ArtifactBody artifact={artifact} asTable={asTable} tableMaxHeight="" />
    </div>
  );
}

function ExportMenu({ artifact }: { artifact: Artifact }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Download className="size-3.5" />
          Exportar
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => exportArtifactCsv(artifact)}>
          <Download className="size-4" />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportArtifactXlsx(artifact)}>
          <FileSpreadsheet className="size-4" />
          Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CanvasMessage({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <TriangleAlert className="size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A chart that throws while drawing stays inside the canvas: the chat
 *  keeps working and «Reintentar» draws it again. */
class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Artifact canvas render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="space-y-3">
        <CanvasMessage>No se pudo mostrar.</CanvasMessage>
        <Button
          variant="outline"
          size="sm"
          onClick={() => this.setState({ failed: false })}
        >
          Reintentar
        </Button>
      </div>
    );
  }
}

/** What an artifact leaves in its chat message: a compact card that puts
 *  it back on the canvas. */
export function ArtifactChip({
  artifact,
  active,
  onOpen,
}: {
  artifact: Artifact;
  active: boolean;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[artifact.kind];
  const count =
    artifact.kind === "chart"
      ? `${artifact.points.length.toLocaleString("es-AR")} puntos`
      : artifact.kind === "calendar"
        ? `${artifact.rows.length.toLocaleString("es-AR")} ${artifact.rows.length === 1 ? "empleado" : "empleados"}`
        : `${artifact.rows.length.toLocaleString("es-AR")} filas`;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onOpen}
      className={cn(
        "flex w-full max-w-sm items-center gap-3 rounded-md border p-3 text-left text-xs transition-colors",
        "bg-muted/30 hover:bg-muted/60 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
        active && "bg-muted/60 border-foreground/20",
      )}
    >
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{artifact.title}</span>
        <span className="text-muted-foreground block truncate">
          {KIND_LABEL[artifact.kind]} · {count}
        </span>
      </span>
    </button>
  );
}
