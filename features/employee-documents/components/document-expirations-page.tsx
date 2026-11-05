"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ReadError } from "@/components/read-error";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatArgentineDate } from "@/lib/format";

import { useExpiringDocuments } from "../hooks/use-employee-documents";
import {
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYEE_DOCUMENT_KIND_LABEL,
  type ExpiringDocumentRow,
} from "../schema";

const ANY_KIND = "__any__";

export function DocumentExpirationsPage() {
  const query = useExpiringDocuments();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>(ANY_KIND);

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (kindFilter !== ANY_KIND && d.kind !== kindFilter) return false;
      if (term && !d.employee_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [query.data, search, kindFilter]);

  const columns = useMemo<ColumnDef<ExpiringDocumentRow>[]>(
    () => [
      {
        accessorKey: "employee_name",
        header: "Empleado",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.employee_name}</span>
        ),
      },
      {
        accessorKey: "kind",
        header: "Documento",
        cell: ({ row }) =>
          EMPLOYEE_DOCUMENT_KIND_LABEL[row.original.kind] ?? row.original.kind,
      },
      {
        accessorKey: "number",
        header: "Número",
        cell: ({ row }) => row.original.number ?? "—",
        meta: { cellClassName: "font-mono text-xs text-muted-foreground" },
      },
      {
        accessorKey: "expires_at",
        header: "Vencimiento",
        cell: ({ row }) => formatArgentineDate(row.original.expires_at),
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "days_until_expiry",
        header: "Días restantes",
        meta: { align: "right" },
        // v_documents_expiring keeps only expires_at >= today: never negative.
        cell: ({ row }) => {
          const days = row.original.days_until_expiry;
          return (
            <Badge
              variant="secondary"
              className={
                days <= 7
                  ? "bg-muted text-foreground dark:text-foreground"
                  : "bg-muted text-muted-foreground dark:text-muted-foreground"
              }
            >
              {days === 0 ? "Vence hoy" : `${days}d`}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <IconButton
            label="Ver empleado"
            variant="ghost"
            className="h-8 w-8"
            asChild
          >
            <Link href={`/employees/${row.original.employee_id}`}>
              <ExternalLink className="size-4" />
            </Link>
          </IconButton>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Vencimientos de documentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Documentos de empleados activos que vencen entre hoy y los próximos 30
          días. Cada mañana se avisa dentro de la app a quienes tienen acceso a
          Personal.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar empleado…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_KIND}>Todos los tipos</SelectItem>
            {EMPLOYEE_DOCUMENT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {EMPLOYEE_DOCUMENT_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {query.data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} de {query.data.length}
          </span>
        )}
      </div>

      {query.isError && !query.data ? (
        <ReadError
          message="No se pudieron cargar los vencimientos de documentos."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(d) => d.id}
          isLoading={query.isLoading}
          emptyMessage={
            (query.data?.length ?? 0) === 0
              ? "Ningún documento por vencer en los próximos 30 días."
              : "Sin resultados para el filtro actual."
          }
        />
      )}
    </div>
  );
}
