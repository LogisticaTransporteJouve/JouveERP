"use client";

import {
  CheckCircle2,
  Info,
  RefreshCw,
  ShieldAlert,
  Triangle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import type { AfipDiagnostics, DiagnosticEntry } from "@/lib/afip/diagnostics";

import type { SalesPointRow } from "../actions/afip-admin-actions";
import { useAfipAdminPanel, useSyncAfipPos } from "../hooks/use-afip-admin";
import { afipAdminKeys } from "../lib/afip-admin-keys";
import { ConfigurePosDialog } from "./configure-pos-dialog";

type ChannelLabels = Record<string, string>;

export function SalesPointsPanel() {
  const { data, isFetching } = useAfipAdminPanel();
  const syncMut = useSyncAfipPos();
  const qc = useQueryClient();
  const [channelLabels, setChannelLabels] = useState<ChannelLabels>({});

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

  function onPosUpdated() {
    // The mutation hook in ConfigurePosDialog handles invalidation; this
    // exists for parity with the previous prop signature so the dialog can
    // forget about the panel.
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
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }
            >
              {diagnostics.env === "prod" ? "Producción" : "Homologación"}
            </Badge>
          )}
          {cuit && (
            <span className="font-mono text-xs">CUIT {cuit}</span>
          )}
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
            <RefreshCw className={syncMut.isPending ? "animate-spin" : undefined} />
            Sincronizar con AFIP
          </Button>
        </div>
      </div>

      {diagnostics && <DiagnosticsSection diagnostics={diagnostics} />}

      <SalesPointsSection
        salesPoints={salesPoints}
        channelLabels={channelLabels}
        onChannelLabels={setChannelLabels}
        onPosUpdated={onPosUpdated}
      />
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
      ? "text-emerald-600 dark:text-emerald-400"
      : entry.status === "warn"
        ? "text-amber-600 dark:text-amber-400"
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

function SalesPointsSection({
  salesPoints,
  channelLabels,
  onChannelLabels,
  onPosUpdated,
}: {
  salesPoints: SalesPointRow[];
  channelLabels: ChannelLabels;
  onChannelLabels: (labels: ChannelLabels) => void;
  onPosUpdated: (row: SalesPointRow) => void;
}) {
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
      {salesPoints.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Todavía no sincronizamos con AFIP. Tocá &ldquo;Sincronizar con
          AFIP&rdquo; para descubrir los puntos disponibles.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Número</TableHead>
              <TableHead>Alias</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Habilitado</TableHead>
              <TableHead>AFIP</TableHead>
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salesPoints.map((p) => (
              <SalesPointRow
                key={p.numero}
                point={p}
                channelLabels={channelLabels}
                onChannelLabels={onChannelLabels}
                onUpdated={onPosUpdated}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function SalesPointRow({
  point,
  channelLabels,
  onChannelLabels,
  onUpdated,
}: {
  point: SalesPointRow;
  channelLabels: ChannelLabels;
  onChannelLabels: (labels: ChannelLabels) => void;
  onUpdated: (row: SalesPointRow) => void;
}) {
  const channelLabel = point.channel_id
    ? (channelLabels[point.channel_id] ?? point.channel_id)
    : null;

  return (
    <TableRow className={!point.is_enabled ? "opacity-60" : undefined}>
      <TableCell className="font-mono">
        {String(point.numero).padStart(5, "0")}
      </TableCell>
      <TableCell>
        {point.nickname ?? (
          <span className="text-muted-foreground">Sin asignar</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {channelLabel ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {point.is_enabled ? (
          <Badge
            variant="secondary"
            className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          >
            Sí
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-muted text-muted-foreground">
            No
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {point.last_known_blocked ? "Bloqueado" : "Activo"}
        {point.last_known_emission_type
          ? ` · ${point.last_known_emission_type}`
          : ""}
      </TableCell>
      <TableCell className="text-right">
        <ConfigurePosDialog
          point={point}
          onChannelLabels={onChannelLabels}
          onUpdated={onUpdated}
        />
      </TableCell>
    </TableRow>
  );
}
