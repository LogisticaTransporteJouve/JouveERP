"use client";

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

import {
  ACCOUNT_TYPE_LABEL,
  type Account,
  type AccountCurrency,
} from "../schema";
import { EditAccountDialog } from "./edit-account-dialog";
import { NewAccountDialog } from "./new-account-dialog";
import { ToggleAccountActiveButton } from "./toggle-account-active-button";

const formatters: Record<AccountCurrency, Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }),
};

function formatBalance(amount: number, currency: AccountCurrency) {
  return formatters[currency].format(amount);
}

export function AccountsTable({
  accounts,
  actorRoles,
}: {
  accounts: Account[];
  actorRoles: Role[];
}) {
  const canWrite = userCan(actorRoles, "accounts:write");

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
                    {account.name}
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
