"use client";

import {
  CheckCircle2,
  Info,
  RefreshCw,
  Settings,
  ShieldAlert,
  Triangle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { AfipDiagnostics, DiagnosticEntry } from "@/lib/afip/diagnostics";

import type { SalesPointRow } from "../actions/afip-admin-actions";
import {
  useAfipAdminPanel,
  useInvoicingChannels,
  useSyncAfipPos,
} from "../hooks/use-afip-admin";
import { afipAdminKeys } from "../lib/afip-admin-keys";
import { ConfigurePosDialog } from "./configure-pos-dialog";

export function SalesPointsPanel() {
  const { data, isFetching } = useAfipAdminPanel();
  const syncMut = useSyncAfipPos();
  const qc = useQueryClient();

  const cuit = data.cuit;
  const diagnostics = data.diagnostics;
  const salesPoints = data.salesPoints;

  function reload() {
    qc.invalidateQueries({ queryKey: afipAdminKeys.panel() });
  }

  function sync() {
    syncMut.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          `${result.total} POS sincronizados (${result.inserted} nuevos, ${result.updated} actualizados).`,
        );
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {diagnostics && (
            <Badge
              variant="secondary"
              className={
                diagnostics.env === "prod"
                  ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                  : "bg-muted text-muted-foreground dark:text-muted-foreground"
              }
            >
              {diagnostics.env === "prod" ? "Producción" : "Homologación"}
            </Badge>
          )}
          {cuit && <span className="font-mono text-xs">CUIT {cuit}</span>}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={reload}
            disabled={isFetching || syncMut.isPending}
          >
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            Refrescar
          </Button>
          <Button
            type="button"
            onClick={sync}
            disabled={isFetching || syncMut.isPending}
          >
            <RefreshCw
              className={syncMut.isPending ? "animate-spin" : undefined}
            />
            Sincronizar con AFIP
          </Button>
        </div>
      </div>

      {diagnostics && <DiagnosticsSection diagnostics={diagnostics} />}

      <SalesPointsSection salesPoints={salesPoints} />
    </div>
  );
}

function DiagnosticsSection({ diagnostics }: { diagnostics: AfipDiagnostics }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Diagnóstico AFIP</h2>
        <p className="text-xs text-muted-foreground">
          Validaciones que tienen que pasar antes de emitir.
        </p>
      </div>
      <ul className="divide-y">
        {diagnostics.entries.map((entry) => (
          <DiagnosticRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function DiagnosticRow({ entry }: { entry: DiagnosticEntry }) {
  const tone =
    entry.status === "ok"
      ? "text-muted-foreground dark:text-muted-foreground"
      : entry.status === "warn"
        ? "text-muted-foreground dark:text-muted-foreground"
        : "text-destructive";

  const Icon =
    entry.status === "ok"
      ? CheckCircle2
      : entry.status === "warn"
        ? Triangle
        : ShieldAlert;

  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{entry.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{entry.message}</p>
      </div>
    </li>
  );
}

function SalesPointsSection({ salesPoints }: { salesPoints: SalesPointRow[] }) {
  const { data: channels } = useInvoicingChannels();
  const channelLabels = useMemo(
    () => Object.fromEntries(channels.map((c) => [c.id, c.name])),
    [channels],
  );
  const [editing, setEditing] = useState<SalesPointRow | null>(null);

  const columns = useMemo<ColumnDef<SalesPointRow>[]>(
    () => [
      {
        accessorKey: "numero",
        header: "Número",
        cell: ({ row }) => (
          <span className={cn(!row.original.is_enabled && "opacity-60")}>
            {String(row.original.numero).padStart(5, "0")}
          </span>
        ),
        meta: { headerClassName: "w-24", cellClassName: "font-mono" },
      },
      {
        accessorKey: "nickname",
        header: "Alias",
        cell: ({ row }) => (
          <span className={cn(!row.original.is_enabled && "opacity-60")}>
            {row.original.nickname ?? (
              <span className="text-muted-foreground">Sin asignar</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "channel_id",
        header: "Canal",
        cell: ({ row }) => {
          const channelLabel = row.original.channel_id
            ? (channelLabels[row.original.channel_id] ??
              row.original.channel_id)
            : null;
          return (
            <span className={cn(!row.original.is_enabled && "opacity-60")}>
              {channelLabel ?? <span className="text-muted-foreground">—</span>}
            </span>
          );
        },
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "is_enabled",
        header: "Habilitado",
        cell: ({ row }) => (
          <span className={cn(!row.original.is_enabled && "opacity-60")}>
            {row.original.is_enabled ? (
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground dark:text-muted-foreground"
              >
                Sí
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground"
              >
                No
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: "afip",
        header: "AFIP",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={cn(!row.original.is_enabled && "opacity-60")}>
            {row.original.last_known_blocked ? "Bloqueado" : "Activo"}
            {row.original.last_known_emission_type
              ? ` · ${row.original.last_known_emission_type}`
              : ""}
          </span>
        ),
        meta: { cellClassName: "text-xs text-muted-foreground" },
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { headerClassName: "w-32", align: "right" },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Configurar"
            onClick={() => setEditing(row.original)}
          >
            <Settings className="size-4" />
          </Button>
        ),
      },
    ],
    [channelLabels],
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Puntos de venta</h2>
          <p className="text-xs text-muted-foreground">
            La info que AFIP no devuelve (canal, alias, habilitación) se
            configura desde acá.
          </p>
        </div>
        <Badge variant="secondary" className="font-mono">
          {salesPoints.length}
        </Badge>
      </div>
      <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>
          <code className="font-mono">FEParamGetPtosVenta</code> sólo devuelve
          los puntos asociados a <strong>WSFEv1</strong> (RG 4291). POS de
          Comprobantes en Línea, WSMTXCA o WSFEX no aparecen.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={salesPoints}
        getRowId={(p) => String(p.numero)}
        wrapperClassName={null}
        emptyMessage="Todavía no sincronizamos con AFIP. Tocá “Sincronizar con AFIP” para descubrir los puntos disponibles."
      />
      <ConfigurePosDialog point={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
