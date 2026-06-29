"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { usePallets } from "../hooks/use-pallets";
import { storedDays } from "../lib/pallet-days";
import { PALLET_STATUS_LABELS, type Pallet } from "../schema";

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "en_deposito", label: "En depósito" },
  { value: "despachado", label: "Despachado" },
] as const;

type Row = Pallet & { days: number };

export function PalletTraceability({
  clientOptions,
}: {
  clientOptions: { id: string; legal_name: string }[];
}) {
  const { data: items } = usePallets();
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo<Row[]>(
    () =>
      items
        .filter((p) => (clientFilter ? p.client_id === clientFilter : true))
        .filter((p) =>
          statusFilter === "all" ? true : p.status === statusFilter,
        )
        .map((p) => ({
          ...p,
          days: storedDays(p.entry_date, p.exit_date, today),
        })),
    [items, clientFilter, statusFilter, today],
  );

  const summary = useMemo(() => {
    const enDeposito = rows.filter((r) => r.status === "en_deposito").length;
    const despachados = rows.filter((r) => r.status === "despachado").length;
    const totalDays = rows.reduce((s, r) => s + r.days, 0);
    return { total: rows.length, enDeposito, despachados, totalDays };
  }, [rows]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Código",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.code}</span>
        ),
        meta: { headerClassName: "w-28" },
      },
      {
        id: "client",
        header: "Cliente",
        enableSorting: false,
        cell: ({ row }) => row.original.client?.legal_name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        id: "warehouse",
        header: "Depósito",
        enableSorting: false,
        cell: ({ row }) => row.original.warehouse?.name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        id: "product",
        header: "Producto",
        enableSorting: false,
        cell: ({ row }) => row.original.product?.name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "quantity",
        header: "Cant.",
        cell: ({ row }) => row.original.quantity ?? "—",
        meta: { headerClassName: "w-20", cellClassName: "text-sm" },
      },
      {
        accessorKey: "entry_date",
        header: "Ingreso",
        cell: ({ row }) => row.original.entry_date,
        meta: { headerClassName: "w-28", cellClassName: "text-sm" },
      },
      {
        accessorKey: "exit_date",
        header: "Salida",
        cell: ({ row }) => row.original.exit_date ?? "—",
        meta: { headerClassName: "w-28", cellClassName: "text-sm" },
      },
      {
        accessorKey: "days",
        header: "Días",
        cell: ({ row }) => row.original.days,
        meta: {
          headerClassName: "w-20",
          align: "right",
          cellClassName: "tabular-nums",
        },
      },
      {
        id: "status",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="secondary">
            {PALLET_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
        meta: { headerClassName: "w-32" },
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Trazabilidad de pallets
        </h1>
        <p className="text-muted-foreground text-sm">
          Historial de ingresos y egresos: cuándo entró, cuándo salió y cuántos
          días estuvo almacenado.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pallets" value={summary.total} />
        <Stat label="En depósito" value={summary.enDeposito} />
        <Stat label="Despachados" value={summary.despachados} />
        <Stat label="Días almacenados" value={summary.totalDays} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          options={clientOptions.map((c) => ({
            value: c.id,
            label: c.legal_name,
          }))}
          value={clientFilter}
          onChange={setClientFilter}
          placeholder="Todos los clientes"
          searchPlaceholder="Buscar cliente…"
          emptyText="Sin clientes."
          className="w-72"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(p) => p.id}
        enablePagination
        initialPageSize={20}
        defaultSorting={[{ id: "entry_date", desc: true }]}
        emptyMessage="Sin movimientos."
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString("es-AR")}
      </div>
    </div>
  );
}
