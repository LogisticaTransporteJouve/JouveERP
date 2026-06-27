"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";

import { formatMoney } from "@/lib/format";

import { useAccountsList } from "../hooks/use-accounts";
import { ACCOUNT_TYPE_LABEL, type Account, type AccountCurrency } from "../schema";
import { AccountOpeningBalanceDialog } from "./account-opening-balance-dialog";
import { EditAccountDialog } from "./edit-account-dialog";
import { NewAccountDialog } from "./new-account-dialog";
import { ToggleAccountActiveButton } from "./toggle-account-active-button";

function formatBalance(amount: number, currency: AccountCurrency) {
  return formatMoney(amount, currency);
}

export function AccountsTable({
  actorRoles,
  channels,
}: {
  actorRoles: Role[];
  channels: Array<{ id: string; name: string }>;
}) {
  const { data: accounts } = useAccountsList();
  const canWrite = userCan(actorRoles, "accounts:write");
  // Only the owner can touch the balance adjustment (matching the client
  // flow). It stays invisible in the UI for finance/admin; the RPC
  // also blocks it just in case.
  const canAdjust = actorRoles.includes("owner");

  const columns = useMemo<ColumnDef<Account>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <div className={row.original.is_active ? undefined : "opacity-60"}>
            <Link
              href={`/transactions?account=${row.original.id}`}
              className="font-medium hover:underline"
              title="Ver movimientos y registrar nuevo"
            >
              {row.original.name}
            </Link>
            {row.original.notes && (
              <div className="text-xs text-muted-foreground">
                {row.original.notes}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "Tipo",
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={row.original.is_active ? undefined : "opacity-60"}
          >
            {ACCOUNT_TYPE_LABEL[row.original.type]}
          </Badge>
        ),
      },
      {
        accessorKey: "currency",
        header: "Moneda",
        cell: ({ row }) => (
          <span
            className={
              row.original.is_active
                ? "font-mono text-xs"
                : "font-mono text-xs opacity-60"
            }
          >
            {row.original.currency}
          </span>
        ),
      },
      {
        accessorKey: "opening_balance",
        header: "Saldo inicial",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span
            className={
              row.original.is_active
                ? "font-mono text-sm"
                : "font-mono text-sm opacity-60"
            }
          >
            {formatBalance(
              Number(row.original.opening_balance ?? 0),
              row.original.currency,
            )}
          </span>
        ),
      },
      {
        accessorKey: "is_active",
        header: "Estado",
        cell: ({ row }) =>
          row.original.is_active ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              Activa
            </span>
          ) : (
            <span className="text-sm text-muted-foreground opacity-60">
              Inactiva
            </span>
          ),
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { headerClassName: "w-24", align: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {canAdjust && (
              <AccountOpeningBalanceDialog
                accountId={row.original.id}
                accountName={row.original.name}
                currency={row.original.currency}
                channels={channels}
              />
            )}
            {canWrite && <EditAccountDialog account={row.original} />}
            {canWrite && (
              <ToggleAccountActiveButton account={row.original} />
            )}
          </div>
        ),
      },
    ],
    [canAdjust, canWrite, channels],
  );

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewAccountDialog />
        </div>
      )}

      <DataTable
        columns={columns}
        data={accounts}
        getRowId={(account) => account.id}
        emptyMessage="Todavía no hay cuentas. Creá la primera con el botón de arriba."
        wrapperClassName="mt-4"
      />
    </>
  );
}
