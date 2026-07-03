"use client";

import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSupplierCategoriesList } from "@/features/supplier-categories/hooks/use-supplier-categories";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useSuppliersSearchInfinite } from "../hooks/use-suppliers";
import { IVA_CONDITION_LABEL, type IvaCondition, type Supplier } from "../schema";
import { DeleteSupplierDialog } from "./delete-supplier-dialog";
import { EditSupplierDialog } from "./edit-supplier-dialog";
import { NewSupplierDialog } from "./new-supplier-dialog";

const IVA_BADGE_TONE: Record<IvaCondition, string> = {
  responsable_inscripto: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  monotributo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  exento: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  consumidor_final: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  no_categorizado: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function SuppliersTable({
  actorRoles,
  initialQuery,
  initialOnlyActive,
  initialCategoryId,
}: {
  actorRoles: Role[];
  initialQuery: string;
  initialOnlyActive: boolean;
  initialCategoryId: string | null;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive);
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const deferredOnlyActive = useDeferredValue(onlyActive);
  const deferredCategoryId = useDeferredValue(categoryId);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "suppliers:write");
  const categoriesQuery = useSupplierCategoriesList({ onlyActive: false });
  const categories = categoriesQuery.data ?? [];

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      inactive: onlyActive ? null : "1",
      category: categoryId,
    });
  }, [debouncedQuery, onlyActive, categoryId, setUrlFilters]);

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por razón social, nombre fantasía o CUIT"
          value={queryInput}
          onChange={onSearchChange}
          className="max-w-md"
        />
        <Select
          value={categoryId ?? "__all"}
          onValueChange={(v) => setCategoryId(v === "__all" ? null : v)}
        >
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="Todas las categorías" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas las categorías</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyActive}
            onCheckedChange={(value) => setOnlyActive(value === true)}
          />
          Solo activos
        </label>
        {canWrite && (
          <div className="ml-auto">
            <NewSupplierDialog />
          </div>
        )}
      </div>

      <div className="mt-4">
        <Suspense fallback={<SuppliersTableSkeleton canWrite={canWrite} />}>
          <SuppliersTableRows
            query={deferredQuery}
            onlyActive={deferredOnlyActive}
            categoryId={deferredCategoryId}
            categoriesById={Object.fromEntries(
              categories.map((c) => [c.id, c.name]),
            )}
            canWrite={canWrite}
          />
        </Suspense>
      </div>
    </>
  );
}

function SuppliersTableRows({
  query,
  onlyActive,
  categoryId,
  categoriesById,
  canWrite,
}: {
  query: string;
  onlyActive: boolean;
  categoryId: string | null;
  categoriesById: Record<string, string>;
  canWrite: boolean;
}) {
  const {
    items: suppliers,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSuppliersSearchInfinite({ query, onlyActive, categoryId });

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => buildColumns({ categoriesById, canWrite }),
    [categoriesById, canWrite],
  );

  return (
    <DataTable
      columns={columns}
      data={suppliers}
      getRowId={(supplier) => supplier.id}
      emptyMessage="No hay proveedores que coincidan."
      footer={
        hasNextPage ? (
          <div
            ref={sentinelRef}
            className="py-4 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </div>
        ) : null
      }
    />
  );
}

function buildColumns({
  categoriesById,
  canWrite,
}: {
  categoriesById: Record<string, string>;
  canWrite: boolean;
}): ColumnDef<Supplier>[] {
  return [
    {
      accessorKey: "legal_name",
      header: "Razón social",
      enableSorting: false,
      meta: { mobile: "primary" },
      cell: ({ row }) => {
        const supplier = row.original;
        return (
          <div className={!supplier.is_active ? "opacity-60" : undefined}>
            <Link
              href={`/suppliers/${supplier.id}`}
              className="font-medium hover:underline"
            >
              {supplier.legal_name}
            </Link>
            {supplier.display_name && (
              <div className="text-xs text-muted-foreground">
                {supplier.display_name}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "cuit",
      header: "CUIT",
      enableSorting: false,
      meta: { mobile: "secondary" },
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.cuit}</span>
      ),
    },
    {
      accessorKey: "iva_condition",
      header: "Condición IVA",
      enableSorting: false,
      meta: { mobile: "secondary" },
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={IVA_BADGE_TONE[row.original.iva_condition]}
        >
          {IVA_CONDITION_LABEL[row.original.iva_condition]}
        </Badge>
      ),
    },
    {
      accessorKey: "category_id",
      header: "Categoría",
      enableSorting: false,
      meta: { mobile: "secondary" },
      cell: ({ row }) => {
        const categoryId = row.original.category_id;
        return categoryId && categoriesById[categoryId] ? (
          <Badge variant="outline" className="text-xs">
            {categoriesById[categoryId]}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "is_active",
      header: "Estado",
      enableSorting: false,
      meta: { mobile: "primary" },
      cell: ({ row }) =>
        row.original.is_active ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            Activo
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Inactivo</span>
        ),
    },
    {
      accessorKey: "updated_at",
      header: "Actualizado",
      enableSorting: false,
      meta: { mobile: "secondary" },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatArgentineDate(row.original.updated_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Acciones",
      enableSorting: false,
      meta: { headerClassName: "w-24", align: "right", mobile: "primary" },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && <EditSupplierDialog supplier={row.original} />}
          {canWrite && <DeleteSupplierDialog supplier={row.original} />}
        </div>
      ),
    },
  ];
}

function SuppliersTableSkeleton({ canWrite }: { canWrite: boolean }) {
  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => buildColumns({ categoriesById: {}, canWrite }),
    [canWrite],
  );
  return <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />;
}
