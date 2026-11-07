"use client";

import { ExportButton } from "@/components/export-button";
import { ListToolbar } from "@/components/list-toolbar";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { treasurySummaryQuery } from "@/features/treasury/lib/treasury-queries";
import type { Access } from "@/lib/auth/permissions";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";

import { formatArgentineDate, formatMoney } from "@/lib/format";

import { useAccountsList } from "../hooks/use-accounts";
import {
  ACCOUNT_TYPE_LABEL,
  type Account,
  type AccountCurrency,
} from "../schema";
import { AccountOpeningBalanceDialog } from "./account-opening-balance-dialog";
import { EditAccountDialog } from "./edit-account-dialog";
import { NewAccountDialog } from "./new-account-dialog";
import { ToggleAccountActiveButton } from "./toggle-account-active-button";

function formatBalance(amount: number, currency: AccountCurrency) {
  return formatMoney(amount, currency);
}

export function AccountsTable({
  actorAccess,
  channels,
}: {
  actorAccess: Access;
  channels: Array<{ id: string; name: string }>;
}) {
  const { data: accounts } = useAccountsList();
  const canWrite = userCan(actorAccess, "accounts:write");
  // Only the owner can touch the balance adjustment (matching the client
  // flow). It stays invisible in the UI for finance/admin; the RPC
  // also blocks it just in case.
  const canAdjust = userCan(actorAccess, "opening_balances:write");
  const canSeeBalances = userCanAll(actorAccess, TREASURY_PERMISSIONS);
  const summary = useQuery({
    ...treasurySummaryQuery(),
    enabled: canSeeBalances,
  });
  const balances = useMemo(
    () => new Map((summary.data?.accounts ?? []).map((a) => [a.id, a])),
    [summary.data],
  );

  const columns = useMemo<ColumnDef<Account>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <div className={row.original.is_active ? undefined : "opacity-60"}>
            <Link
              href={`/accounts/${row.original.id}`}
              className="font-medium hover:underline"
              title="Ver movimientos y extracto"
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
      ...(canSeeBalances
        ? ([
            {
              id: "balance_now",
              header: "Saldo actual",
              enableSorting: false,
              meta: { align: "right" },
              cell: ({ row }) => {
                const b = balances.get(row.original.id);
                return (
                  <span className="font-mono text-sm">
                    {b ? formatBalance(b.balance_now, b.currency) : "—"}
                  </span>
                );
              },
            },
            {
              id: "month_change",
              header: "Cambio del mes",
              enableSorting: false,
              meta: {
                align: "right",
                cellClassName: "font-mono text-xs text-muted-foreground",
              },
              cell: ({ row }) => {
                const b = balances.get(row.original.id);
                if (!b) return "—";
                const delta = b.balance_now - b.balance_prev_eom;
                if (Math.abs(delta) < 0.01) return "—";
                return `${delta > 0 ? "+" : ""}${formatMoney(delta, b.currency)}`;
              },
            },
            {
              id: "last_movement",
              header: "Último mov.",
              enableSorting: false,
              meta: { cellClassName: "text-xs text-muted-foreground" },
              cell: ({ row }) => {
                const date = balances.get(row.original.id)?.last_movement_date;
                return date ? formatArgentineDate(date) : "—";
              },
            },
          ] satisfies ColumnDef<Account>[])
        : []),
      {
        accessorKey: "is_active",
        header: "Estado",
        cell: ({ row }) =>
          row.original.is_active ? (
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
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
            {canWrite && <ToggleAccountActiveButton account={row.original} />}
          </div>
        ),
      },
    ],
    [balances, canAdjust, canSeeBalances, canWrite, channels],
  );

  return (
    <>
      <ListToolbar
        actions={
          <>
            <ExportButton resource="accounts" />
            {canWrite && <NewAccountDialog />}
          </>
        }
      />

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
