"use client";

import { Loader2, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ColumnDef } from "@/components/ui/data-table";

import type { PendingExtraction } from "../actions";
import {
  CONFIDENCE_CONFIG,
  confidenceBand,
  documentTypeLabel,
  statusConfig,
} from "../lib/document-config";

function matchName(matches: unknown): string {
  if (typeof matches !== "object" || matches === null) return "—";
  const m = matches as Record<string, unknown>;
  if (typeof m.supplier_name === "string") return m.supplier_name;
  if (typeof m.client_name === "string") return m.client_name;
  return "—";
}

export function buildDocumentColumns(opts: {
  onReview: (id: string) => void;
  onDiscard: (id: string) => void;
}): ColumnDef<PendingExtraction>[] {
  return [
    {
      accessorKey: "file",
      header: "Archivo",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-[16rem] truncate font-medium">
          {row.original.file?.original_filename ?? "documento"}
        </span>
      ),
    },
    {
      id: "type",
      header: "Tipo",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.detected_type === null ? (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" /> Leyendo…
          </span>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" />
            {documentTypeLabel(row.original.detected_type)}
          </Badge>
        ),
    },
    {
      id: "counterparty",
      header: "Contraparte",
      enableSorting: false,
      cell: ({ row }) => matchName(row.original.matches),
      meta: { cellClassName: "max-w-[12rem] truncate text-muted-foreground text-sm" },
    },
    {
      id: "confidence",
      header: "Confianza",
      enableSorting: false,
      meta: { headerClassName: "w-28" },
      cell: ({ row }) => {
        const band = confidenceBand(row.original.confidence);
        if (!band) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        const Icon = CONFIDENCE_CONFIG[band].icon;
        return (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Icon className="size-3" /> {CONFIDENCE_CONFIG[band].label}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Estado",
      enableSorting: false,
      meta: { headerClassName: "w-28" },
      cell: ({ row }) => {
        const s = statusConfig(row.original.status);
        const Icon = s.icon;
        return (
          <span className={`flex items-center gap-1 text-xs ${s.className}`}>
            <Icon className="size-3" /> {s.label}
          </span>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: "Creado",
      meta: { headerClassName: "w-24" },
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {new Date(row.original.created_at).toLocaleDateString("es-AR")}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      meta: { headerClassName: "w-32", align: "right" },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={row.original.detected_type === null}
            onClick={() => opts.onReview(row.original.id)}
          >
            Revisar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => opts.onDiscard(row.original.id)}
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Descartar</span>
          </Button>
        </div>
      ),
    },
  ];
}
