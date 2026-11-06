"use client";

import { Download, Eye, FilterX, Search } from "lucide-react";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { downloadCsv } from "@/lib/export/csv";
import { formatArgentineDateTime } from "@/lib/format";

import {
  useAuditEvents,
  useAuditFilterOptions,
  useAuditUserNames,
  useExportAuditCsv,
} from "../hooks/use-audit";
import { auditActorLabel } from "../lib/actor";
import { groupAiTurns, type AuditListItem } from "../lib/ai-turns";
import { AUDIT_GROUPS, isAuditGroupId } from "../lib/registry";
import {
  AUDIT_SEARCH_MAX,
  EMPTY_AUDIT_FILTERS,
  type AuditFilters,
} from "../schema";

import { AuditDetailDialog } from "./audit-detail-dialog";
import { AuditSubjectLink } from "./audit-subject-link";

export function AuditView() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuditListItem | null>(null);
  const exportCsv = useExportAuditCsv();
  const q = useDebouncedValue(search.trim(), 300);
  const applied = useMemo(() => ({ ...filters, q: q || null }), [filters, q]);
  // The previous list stays on screen while the new one loads.
  const shown = useDeferredValue(applied);
  const invalidRange =
    !!filters.from && !!filters.to && filters.from > filters.to;

  function set<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value || null }));
  }

  function onExport() {
    exportCsv.mutate(applied, {
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

      <Suspense fallback={<Skeleton className="h-28 w-full" />}>
        <AuditFiltersBar
          filters={filters}
          search={search}
          onSearch={setSearch}
          onChange={set}
          onClear={() => {
            setFilters(EMPTY_AUDIT_FILTERS);
            setSearch("");
          }}
        />
      </Suspense>

      {invalidRange ? (
        <p className="text-sm text-muted-foreground">
          La fecha desde no puede ser posterior a la fecha hasta.
        </p>
      ) : (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <AuditTable
            filters={shown}
            stale={shown !== applied}
            onOpen={setSelected}
          />
        </Suspense>
      )}

      <AuditDetailDialog
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function AuditFiltersBar({
  filters,
  search,
  onSearch,
  onChange,
  onClear,
}: {
  filters: AuditFilters;
  search: string;
  onSearch: (value: string) => void;
  onChange: <K extends keyof AuditFilters>(
    key: K,
    value: AuditFilters[K],
  ) => void;
  onClear: () => void;
}) {
  const { data } = useAuditFilterOptions();
  const hasFilters =
    search.trim() !== "" ||
    !!filters.from ||
    !!filters.to ||
    !!filters.actorId ||
    !!filters.group ||
    !!filters.hideAiQueries;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          aria-label="Buscar"
          value={search}
          maxLength={AUDIT_SEARCH_MAX}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar por cliente, proveedor, número o patente (p. ej. Transportes Sur, 22312, AE463UF)"
          className="pl-8"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
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
          <Label htmlFor="audit-group">Qué</Label>
          <Combobox
            id="audit-group"
            options={AUDIT_GROUPS.map((g) => ({ value: g.id, label: g.label }))}
            value={filters.group ?? ""}
            onChange={(v) => onChange("group", isAuditGroupId(v) ? v : null)}
            placeholder="Todo"
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
      <div className="flex items-center gap-2">
        <Switch
          id="audit-hide-ai"
          checked={!!filters.hideAiQueries}
          onCheckedChange={(checked) => onChange("hideAiQueries", checked)}
        />
        <Label htmlFor="audit-hide-ai" className="font-normal">
          Ocultar consultas del asistente
        </Label>
      </div>
    </div>
  );
}

function AuditTable({
  filters,
  stale,
  onOpen,
}: {
  filters: AuditFilters;
  stale: boolean;
  onOpen: (item: AuditListItem) => void;
}) {
  const { rows, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAuditEvents(filters);
  const names = useAuditUserNames();
  const items = useMemo(() => groupAiTurns(rows), [rows]);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  const columns = useMemo<ColumnDef<AuditListItem>[]>(
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
        meta: { headerClassName: "w-48", mobile: "secondary" },
        cell: ({ row }) => auditActorLabel(row.original, names),
      },
      {
        id: "sentence",
        header: "Qué hizo",
        enableSorting: false,
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <span className="line-clamp-3">{row.original.sentence}</span>
        ),
      },
      {
        id: "subject",
        header: "Sobre qué",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) =>
          row.original.kind === "event" ? (
            <AuditSubjectLink subject={row.original.subject} />
          ) : (
            "—"
          ),
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
    <div className={stale ? "opacity-60 transition-opacity" : undefined}>
      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        onRowClick={onOpen}
        emptyMessage="No hay eventos con esos filtros."
        footer={
          hasNextPage ? (
            <div
              ref={sentinelRef}
              className="py-4 text-center text-xs text-muted-foreground"
            >
              Cargando…
            </div>
          ) : null
        }
      />
    </div>
  );
}
