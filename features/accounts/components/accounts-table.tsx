"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";

import { formatMoney } from "@/lib/format";

import { useAccountsList } from "../hooks/use-accounts";
import { ACCOUNT_TYPE_LABEL, type AccountCurrency } from "../schema";
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

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewAccountDialog />
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead className="text-right">Saldo inicial</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay cuentas. Creá la primera con el botón de
                  arriba.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow
                  key={account.id}
                  className={!account.is_active ? "opacity-60" : undefined}
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/transactions?account=${account.id}`}
                      className="hover:underline"
                      title="Ver movimientos y registrar nuevo"
                    >
                      {account.name}
                    </Link>
                    {account.notes && (
                      <div className="text-xs text-muted-foreground">
                        {account.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {ACCOUNT_TYPE_LABEL[account.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {account.currency}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatBalance(
                      Number(account.opening_balance ?? 0),
                      account.currency,
                    )}
                  </TableCell>
                  <TableCell>
                    {account.is_active ? (
                      <span className="text-sm text-emerald-600 dark:text-emerald-400">
                        Activa
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Inactiva
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {canAdjust && (
                        <AccountOpeningBalanceDialog
                          accountId={account.id}
                          accountName={account.name}
                          currency={account.currency}
                          channels={channels}
                        />
                      )}
                      {canWrite && <EditAccountDialog account={account} />}
                      {canWrite && (
                        <ToggleAccountActiveButton account={account} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
