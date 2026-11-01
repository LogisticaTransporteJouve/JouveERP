"use client";

import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ExportButton } from "@/components/export-button";
import {
  ListPending,
  ListSearch,
  ListToolbar,
} from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useClientsSearchInfinite } from "../hooks/use-clients";
import { IVA_CONDITION_LABEL, type Client, type IvaCondition } from "../schema";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EditClientDialog } from "./edit-client-dialog";
import { NewClientDialog } from "./new-client-dialog";

const IVA_BADGE_TONE: Record<IvaCondition, string> = {
  responsable_inscripto: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  monotributo: "bg-muted text-muted-foreground dark:text-muted-foreground",
  exento: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  consumidor_final: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  no_categorizado: "bg-muted text-muted-foreground dark:text-muted-foreground",
};

// Server-ordered + partially loaded (infinite scroll), so client sorting is
// disabled on every column.
function useClientColumns(canWrite: boolean): ColumnDef<Client>[] {
  return useMemo<ColumnDef<Client>[]>(
    () => [
      {
        accessorKey: "legal_name",
        header: "Razón social",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            <Link
              href={`/clients/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.legal_name}
            </Link>
            {row.original.display_name && (
              <div className="text-xs text-muted-foreground">
                {row.original.display_name}
              </div>
            )}
          </>
        ),
      },
      {
        accessorKey: "cuit",
        header: "CUIT",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.cuit}</span>
        ),
      },
      {
        accessorKey: "iva_condition",
        header: "Condición IVA",
        enableSorting: false,
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
        accessorKey: "is_active",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.is_active ? (
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
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
        cell: ({ row }) => formatArgentineDate(row.original.updated_at),
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { headerClassName: "w-24 text-right", align: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {canWrite && <EditClientDialog client={row.original} />}
            {canWrite && <DeleteClientDialog client={row.original} />}
          </div>
        ),
      },
    ],
    [canWrite],
  );
}

export function ClientsTable({
  actorAccess,
  initialQuery,
  initialOnlyActive,
}: {
  actorAccess: Access;
  initialQuery: string;
  initialOnlyActive: boolean;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  // useDeferredValue keeps the previous Suspense subtree visible while the
  // new (query, onlyActive) combo is fetching, instead of throwing back to
  // the top-level fallback on every keystroke.
  const deferredQuery = useDeferredValue(debouncedQuery);
  const deferredOnlyActive = useDeferredValue(onlyActive);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorAccess, "clients:write");

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      inactive: onlyActive ? null : "1",
    });
  }, [debouncedQuery, onlyActive, setUrlFilters]);

  const isFiltered = queryInput.trim() !== "" || !onlyActive;
  const pending =
    deferredQuery !== debouncedQuery || deferredOnlyActive !== onlyActive;

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={() => {
          setQueryInput("");
          setOnlyActive(true);
        }}
        actions={
          <>
            <ExportButton resource="clients" />
            {canWrite && <NewClientDialog />}
          </>
        }
      >
        <ListSearch
          placeholder="Buscar por razón social, nombre fantasía o CUIT"
          value={queryInput}
          onChange={setQueryInput}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyActive}
            onCheckedChange={(value) => setOnlyActive(value === true)}
          />
          Solo activos
        </label>
      </ListToolbar>

      <div className="mt-4">
        <Suspense fallback={<ClientsTableSkeleton canWrite={canWrite} />}>
          <ListPending pending={pending}>
            <ClientsTableRows
              query={deferredQuery}
              onlyActive={deferredOnlyActive}
              canWrite={canWrite}
            />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function ClientsTableRows({
  query,
  onlyActive,
  canWrite,
}: {
  query: string;
  onlyActive: boolean;
  canWrite: boolean;
}) {
  const {
    items: clients,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useClientsSearchInfinite({ query, onlyActive });

  const columns = useClientColumns(canWrite);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  return (
    <DataTable
      columns={columns}
      data={clients}
      getRowId={(client) => client.id}
      emptyMessage="No hay clientes que coincidan."
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

function ClientsTableSkeleton({ canWrite }: { canWrite: boolean }) {
  const columns = useClientColumns(canWrite);
  return <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />;
}
