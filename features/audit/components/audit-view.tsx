"use client";

import { Download, Eye, FilterX } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/export/csv";
import { formatArgentineDateTime } from "@/lib/format";

import {
  useAuditEvents,
  useAuditFilterOptions,
  useAuditUserNames,
  useExportAuditCsv,
} from "../hooks/use-audit";
import { auditActorLabel } from "../lib/actor";
import { auditModuleLabel, auditModulesOf } from "../lib/modules";
import {
  EMPTY_AUDIT_FILTERS,
  type AuditEventRow,
  type AuditFilters,
} from "../schema";

import { AuditDetailDialog } from "./audit-detail-dialog";

export function AuditView() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [selected, setSelected] = useState<AuditEventRow | null>(null);
  const exportCsv = useExportAuditCsv();
  const invalidRange =
    !!filters.from && !!filters.to && filters.from > filters.to;

  function set<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value || null }));
  }

  function onExport() {
    exportCsv.mutate(filters, {
      onSuccess: (data) => {
        if (data.rows === 0) {
          toast.error("No hay eventos para exportar con esos filtros.");
          return;
        }
        downloadCsv(data.fileName, data.csv);
        if (data.truncated) {
          toast.warning(
            `Se exportaron los ${data.rows} eventos más recientes; acotá las fechas para el resto.`,
          );
        } else {
          toast.success(`${data.rows} evento(s) exportados.`);
        }
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auditoría</h1>
          <p className="text-muted-foreground text-sm">
            Quién hizo qué y cuándo: usuarios, el asistente IA (con quien lo
            pidió) y los procesos automáticos. Se guardan 400 días.
          </p>
        </div>
        <DisabledHint
          reason={
            invalidRange
              ? "La fecha desde no puede ser posterior a la fecha hasta."
              : null
          }
        >
          <Button
            variant="outline"
            onClick={onExport}
            disabled={exportCsv.isPending || invalidRange}
          >
            <Download />
            {exportCsv.isPending ? "Exportando…" : "Exportar CSV"}
          </Button>
        </DisabledHint>
      </div>

      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        <AuditFiltersBar
          filters={filters}
          onChange={set}
          onClear={() => setFilters(EMPTY_AUDIT_FILTERS)}
        />
      </Suspense>

      {invalidRange ? (
        <p className="text-sm text-muted-foreground">
          La fecha desde no puede ser posterior a la fecha hasta.
        </p>
      ) : (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <AuditTable filters={filters} onOpen={setSelected} />
        </Suspense>
      )}

      <AuditDetailDialog
        event={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function AuditFiltersBar({
  filters,
  onChange,
  onClear,
}: {
  filters: AuditFilters;
  onChange: <K extends keyof AuditFilters>(
    key: K,
    value: AuditFilters[K],
  ) => void;
  onClear: () => void;
}) {
  const { data } = useAuditFilterOptions();
  const modules = useMemo(
    () => auditModulesOf(data.eventTypes),
    [data.eventTypes],
  );
  const eventTypes = filters.module
    ? data.eventTypes.filter((t) => t.startsWith(`${filters.module}.`))
    : data.eventTypes;
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
      <div className="space-y-1">
        <Label htmlFor="audit-from">Desde</Label>
        <DatePicker
          id="audit-from"
          value={filters.from ?? ""}
          onChange={(v) => onChange("from", v)}
          clearable
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to">Hasta</Label>
        <DatePicker
          id="audit-to"
          value={filters.to ?? ""}
          onChange={(v) => onChange("to", v)}
          clearable
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-user">Usuario</Label>
        <Combobox
          id="audit-user"
          options={data.users.map((u) => ({ value: u.id, label: u.label }))}
          value={filters.actorId ?? ""}
          onChange={(v) => onChange("actorId", v)}
          placeholder="Todos"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-module">Módulo</Label>
        <Combobox
          id="audit-module"
          options={modules.map((m) => ({ value: m.id, label: m.label }))}
          value={filters.module ?? ""}
          onChange={(v) => {
            onChange("module", v);
            if (filters.eventType && !filters.eventType.startsWith(`${v}.`)) {
              onChange("eventType", null);
            }
          }}
          placeholder="Todos"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-event">Acción</Label>
        <Combobox
          id="audit-event"
          options={eventTypes.map((t) => ({ value: t, label: t }))}
          value={filters.eventType ?? ""}
          onChange={(v) => onChange("eventType", v)}
          placeholder="Todas"
        />
      </div>
      <DisabledHint
        reason={!hasFilters ? "No hay filtros para limpiar." : null}
        className="justify-self-start"
      >
        <Button
          variant="ghost"
          onClick={onClear}
          disabled={!hasFilters}
          className="justify-self-start"
        >
          <FilterX />
          Limpiar
        </Button>
      </DisabledHint>
    </div>
  );
}

function AuditTable({
  filters,
  onOpen,
}: {
  filters: AuditFilters;
  onOpen: (row: AuditEventRow) => void;
}) {
  const { rows, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAuditEvents(filters);
  const names = useAuditUserNames();

  const columns = useMemo<ColumnDef<AuditEventRow>[]>(
    () => [
      {
        accessorKey: "ts",
        header: "Fecha",
        enableSorting: false,
        meta: { headerClassName: "w-40", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatArgentineDateTime(row.original.ts)}
          </span>
        ),
      },
      {
        id: "actor",
        header: "Quién",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => auditActorLabel(row.original, names),
      },
      {
        accessorKey: "event_type",
        header: "Acción",
        enableSorting: false,
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-mono text-xs">{row.original.event_type}</p>
            <p className="text-muted-foreground text-xs">
              {auditModuleLabel(row.original.module)}
            </p>
          </div>
        ),
      },
      {
        id: "summary",
        header: "Resumen",
        enableSorting: false,
        meta: { mobile: "hidden" },
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            {row.original.summary ?? "—"}
          </span>
        ),
      },
      {
        id: "record",
        header: "Registro",
        enableSorting: false,
        meta: { headerClassName: "w-28", mobile: "secondary" },
        cell: ({ row }) => {
          const { record_href, target_resource_id } = row.original;
          if (!target_resource_id) return "—";
          return record_href ? (
            <Link
              href={record_href}
              className="font-mono text-xs underline"
              onClick={(e) => e.stopPropagation()}
            >
              Abrir
            </Link>
          ) : (
            <span className="font-mono text-xs">
              {target_resource_id.slice(0, 8)}
            </span>
          );
        },
      },
      {
        id: "detail",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-28", align: "right", mobile: "primary" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row.original);
            }}
          >
            <Eye />
            Ver detalle
          </Button>
        ),
      },
    ],
    [names, onOpen],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowClick={onOpen}
      emptyMessage="No hay eventos con esos filtros."
      footer={
        hasNextPage ? (
          <div className="flex justify-center border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? "Cargando…" : "Cargar más"}
            </Button>
          </div>
        ) : null
      }
    />
  );
}
