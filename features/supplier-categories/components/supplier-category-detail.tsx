"use client";

import { CalendarRange, Receipt, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PeriodFilter } from "@/components/period-filter";
import { usePageScope } from "@/components/providers/scope-provider";
import { ReadError } from "@/components/read-error";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StatGrid,
  StatNote,
  StatTile,
  StatValue,
} from "@/components/ui/stat-tile";
import {
  formatInvoiceNumber,
  purchaseKindLabel,
} from "@/features/purchase-invoices/schema";
import { useListParams } from "@/hooks/use-list-params";
import {
  formatArgentineDate,
  formatInteger,
  formatMoney,
  formatMoneySigned,
  formatPeriod,
} from "@/lib/format";
import type { PeriodSelection } from "@/lib/list-period";

import type { SupplierCategoryPurchase } from "../actions/supplier-categories-actions";
import {
  useSupplierCategoryPurchases,
  useSupplierCategorySpend,
} from "../hooks/use-supplier-category-detail";
import { CATEGORY_PURCHASES_LIMIT } from "../lib/category-detail-queries";
import {
  categoryPeriodRange,
  categoryPeriodToUrl,
  DEFAULT_CATEGORY_PERIOD,
} from "../lib/category-period";
import type {
  CategoryMonthSpend,
  CategorySupplierSpend,
} from "../lib/category-spend";

const NO_PURCHASE_READ =
  "No tenés permiso para ver compras: los montos de esta categoría no se muestran.";

const monthColumns: ColumnDef<CategoryMonthSpend>[] = [
  {
    accessorKey: "period",
    header: "Mes",
    cell: ({ row }) => (
      <span className="capitalize">{formatPeriod(row.original.period)}</span>
    ),
  },
  {
    accessorKey: "documents",
    header: "Compras",
    meta: { align: "right", headerClassName: "w-28" },
    cell: ({ row }) => formatInteger(row.original.documents),
  },
  {
    accessorKey: "net",
    header: "Neto",
    meta: { align: "right", headerClassName: "w-40" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {formatMoneySigned(row.original.net)}
      </span>
    ),
  },
];

const supplierColumns: ColumnDef<CategorySupplierSpend>[] = [
  {
    accessorKey: "legalName",
    header: "Proveedor",
    meta: { cellClassName: "min-w-48 whitespace-normal" },
    cell: ({ row }) => (
      <Link
        href={`/suppliers/${row.original.supplierId}`}
        className="font-medium hover:underline"
      >
        {row.original.legalName}
      </Link>
    ),
  },
  {
    accessorKey: "documents",
    header: "Compras",
    meta: { align: "right", headerClassName: "w-28" },
    cell: ({ row }) => formatInteger(row.original.documents),
  },
  {
    accessorKey: "net",
    header: "Neto",
    meta: { align: "right", headerClassName: "w-40" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {formatMoneySigned(row.original.net)}
      </span>
    ),
  },
];

const purchaseColumns: ColumnDef<SupplierCategoryPurchase>[] = [
  {
    accessorKey: "fecha",
    header: "Fecha",
    meta: { headerClassName: "w-28" },
    cell: ({ row }) => formatArgentineDate(row.original.fecha),
  },
  {
    accessorKey: "numero",
    header: "Comprobante",
    enableSorting: false,
    cell: ({ row }) => {
      const p = row.original;
      return (
        <Link
          href={`/purchases/${p.id}`}
          className="font-mono text-xs hover:underline"
        >
          <div className="font-medium">
            {purchaseKindLabel(p.kind, !p.is_fiscal)}
          </div>
          <div className="text-muted-foreground">{formatInvoiceNumber(p)}</div>
        </Link>
      );
    },
  },
  {
    accessorKey: "supplier_legal_name",
    header: "Proveedor",
    meta: { cellClassName: "min-w-48 whitespace-normal" },
    cell: ({ row }) => (
      <Link
        href={`/suppliers/${row.original.supplier_id}`}
        className="hover:underline"
      >
        {row.original.supplier_legal_name}
      </Link>
    ),
  },
  {
    accessorKey: "imp_total",
    header: "Total",
    meta: { align: "right", headerClassName: "w-40" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {formatMoney(
          row.original.imp_total,
          row.original.moneda === "PES" ? "ARS" : "USD",
        )}
      </span>
    ),
  },
];

/**
 * A supplier category's spend in a period: totals, by month, by supplier and
 * its latest purchases, on the channel side the menu is on.
 */
export function SupplierCategoryDetail({
  categoryId,
  initialPeriod,
  canReadPurchases,
}: {
  categoryId: string;
  initialPeriod: PeriodSelection;
  /** purchase_invoices:read: without it no amount is read or shown. */
  canReadPurchases: boolean;
}) {
  const scope = usePageScope();
  const [initial] = useState(() => ({ period: initialPeriod }));
  const { params, update } = useListParams({
    initial,
    defaults: { period: DEFAULT_CATEGORY_PERIOD },
    toUrl: categoryPeriodToUrl,
  });
  const range = useMemo(
    () => categoryPeriodRange(params.period),
    [params.period],
  );

  const spend = useSupplierCategorySpend(
    categoryId,
    range,
    scope,
    canReadPurchases,
  );
  const purchases = useSupplierCategoryPurchases(
    categoryId,
    range,
    scope,
    canReadPurchases,
  );

  if (!canReadPurchases) {
    return (
      <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
        {NO_PURCHASE_READ}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {scope === "internal"
            ? "Otras compras (remitos internos) a proveedores de esta categoría."
            : "Compras (facturas recibidas) a proveedores de esta categoría."}
        </p>
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
      </div>

      {spend.isError ? (
        <ReadError
          message="No se pudieron leer los gastos de la categoría."
          onRetry={() => void spend.refetch()}
        />
      ) : !spend.data ? (
        <div className="space-y-6">
          <StatGrid className="xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </StatGrid>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <StatGrid className="xl:grid-cols-3">
            <StatTile label="Total gastado">
              <StatValue>{formatMoneySigned(spend.data.net)}</StatValue>
              <StatNote>
                Neto sin IVA en pesos; las notas de crédito restan.
              </StatNote>
            </StatTile>
            <StatTile label="Compras">
              <StatValue>{formatInteger(spend.data.documents)}</StatValue>
              <StatNote>Comprobantes recibidos, NC y ND incluidas.</StatNote>
            </StatTile>
            <StatTile label="Proveedores">
              <StatValue>
                {spend.data.suppliersPartial && "≥ "}
                {formatInteger(spend.data.suppliers.length)}
              </StatValue>
              <StatNote>Con compras en el período.</StatNote>
            </StatTile>
          </StatGrid>

          <Section title="Por mes" icon={CalendarRange}>
            <DataTable
              columns={monthColumns}
              data={spend.data.months}
              getRowId={(m) => m.period}
              emptyMessage="Sin compras en el período."
            />
          </Section>

          <Section
            title="Por proveedor"
            icon={Truck}
            description={
              spend.data.suppliersPartial
                ? "La lista está incompleta: el período tiene demasiados proveedores. Elegí un período más corto."
                : undefined
            }
          >
            <DataTable
              columns={supplierColumns}
              data={spend.data.suppliers}
              getRowId={(s) => s.supplierId}
              emptyMessage="Sin compras en el período."
            />
          </Section>
        </>
      )}

      <Section
        title="Últimas compras"
        icon={Receipt}
        description={
          purchases.data?.hasMore
            ? `Las ${CATEGORY_PURCHASES_LIMIT} más recientes del período.`
            : undefined
        }
      >
        {purchases.isError ? (
          <ReadError
            message="No se pudieron leer las compras de la categoría."
            onRetry={() => void purchases.refetch()}
          />
        ) : (
          <DataTable
            columns={purchaseColumns}
            data={purchases.data?.purchases ?? []}
            isLoading={!purchases.data}
            getRowId={(p) => p.id}
            emptyMessage="Sin compras en el período."
          />
        )}
      </Section>
    </div>
  );
}
