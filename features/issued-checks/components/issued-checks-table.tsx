"use client";

import { Ban, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Account } from "@/features/accounts/schema";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import {
  useIssuedChecksList,
  useTransitionIssuedCheck,
} from "../hooks/use-issued-checks";
import {
  ISSUED_CHECK_KIND_LABEL,
  ISSUED_CHECK_STATUS_LABEL,
  type IssuedCheck,
} from "../schema";

import { EditIssuedCheckDialog } from "./edit-issued-check-dialog";
import { NewIssuedCheckDialog } from "./new-issued-check-dialog";

const fmtMoney = (amount: number, currency: string) => {
  const sign = currency === "USD" ? "US$" : "$";
  return `${sign}${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const STATUS_BADGE: Record<string, string> = {
  emitted: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  cashed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export function IssuedChecksTable({
  accounts,
  actorRoles,
}: {
  accounts: Account[];
  actorRoles: Role[];
}) {
  const { data: checks } = useIssuedChecksList();
  const transitionMut = useTransitionIssuedCheck();
  const canWrite = userCan(actorRoles, "issued_checks:write");

  function transition(
    id: string,
    to: "cashed" | "rejected" | "cancelled",
    label: string,
  ) {
    if (
      !confirm(
        to === "cancelled"
          ? "¿Anular este cheque?"
          : `¿Marcar el cheque como ${label.toLowerCase()}?`,
      )
    )
      return;
    transitionMut.mutate(
      { id, to_status: to },
      {
        onSuccess: () => toast.success(`Cheque ${label.toLowerCase()}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewIssuedCheckDialog accounts={accounts} />
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cheque</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Beneficiario</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay cheques propios cargados.
                </TableCell>
              </TableRow>
            ) : (
              checks.map((c: IssuedCheck) => {
                const isOpen = c.status === "emitted";
                return (
                  <TableRow
                    key={c.id}
                    className={isOpen ? undefined : "opacity-70"}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="font-medium">#{c.check_number}</div>
                      <div className="text-muted-foreground">{c.bank_name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {ISSUED_CHECK_KIND_LABEL[c.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {c.supplier_legal_name ?? c.beneficiary_name ?? "—"}
                      </div>
                      {c.beneficiary_cuit && (
                        <div className="font-mono text-xs text-muted-foreground">
                          CUIT {c.beneficiary_cuit}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(c.due_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtMoney(Number(c.amount), c.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={STATUS_BADGE[c.status]}
                      >
                        {ISSUED_CHECK_STATUS_LABEL[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && isOpen && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Marcar cobrado"
                              title="Marcar cobrado"
                              onClick={() =>
                                transition(c.id, "cashed", "Cobrado")
                              }
                            >
                              <CheckCircle2 className="size-4 text-emerald-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Marcar rechazado"
                              title="Marcar rechazado"
                              onClick={() =>
                                transition(c.id, "rejected", "Rechazado")
                              }
                            >
                              <XCircle className="size-4 text-red-600" />
                            </Button>
                            <EditIssuedCheckDialog
                              check={c}
                              accounts={accounts}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Anular"
                              title="Anular"
                              onClick={() =>
                                transition(c.id, "cancelled", "Anulado")
                              }
                            >
                              <Ban className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
