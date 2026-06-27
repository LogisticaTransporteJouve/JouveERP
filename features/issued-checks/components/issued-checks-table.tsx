"use client";

import { Ban, CheckCircle2, XCircle } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import type { Account } from "@/features/accounts/schema";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";

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
  const confirm = useConfirm();
  const canWrite = userCan(actorRoles, "issued_checks:write");

  const columns = useMemo<ColumnDef<IssuedCheck>[]>(() => {
    async function transition(
      id: string,
      to: "cashed" | "rejected" | "cancelled",
      label: string,
    ) {
      const isCancel = to === "cancelled";
      const ok = await confirm({
        title: isCancel
          ? "Anular este cheque"
          : `Marcar el cheque como ${label.toLowerCase()}`,
        description: isCancel
          ? "El cheque queda fuera de circulación. Esta acción no se puede deshacer desde la UI."
          : `Vas a cambiar el estado del cheque a ${label.toLowerCase()}.`,
        confirmLabel: label,
        tone: isCancel || to === "rejected" ? "destructive" : "default",
      });
      if (!ok) return;
      transitionMut.mutate(
        { id, to_status: to },
        {
          onSuccess: () => toast.success(`Cheque ${label.toLowerCase()}.`),
          onError: (err) => toast.error(err.message),
        },
      );
    }

    return [
      {
        accessorKey: "check_number",
        header: "Cheque",
        cell: ({ row }) => (
          <div className="font-mono text-xs">
            <div className="font-medium">#{row.original.check_number}</div>
            <div className="text-muted-foreground">
              {row.original.bank_name}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-xs">
            {ISSUED_CHECK_KIND_LABEL[row.original.kind]}
          </Badge>
        ),
      },
      {
        id: "beneficiary",
        header: "Beneficiario",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            <div className="text-sm">
              {row.original.supplier_legal_name ??
                row.original.beneficiary_name ??
                "—"}
            </div>
            {row.original.beneficiary_cuit && (
              <div className="font-mono text-xs text-muted-foreground">
                CUIT {row.original.beneficiary_cuit}
              </div>
            )}
          </>
        ),
      },
      {
        accessorKey: "due_date",
        header: "Vence",
        cell: ({ row }) => formatArgentineDate(row.original.due_date),
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        accessorKey: "amount",
        header: "Monto",
        cell: ({ row }) => (
          <span className="font-mono">
            {row.original.currency === "USD" ? "US$" : "$"}
            {formatNumber2(Number(row.original.amount))}
          </span>
        ),
        meta: { align: "right" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant="secondary" className={STATUS_BADGE[row.original.status]}>
            {ISSUED_CHECK_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { headerClassName: "w-32", align: "right" },
        cell: ({ row }) => {
          const c = row.original;
          const isOpen = c.status === "emitted";
          return (
            <div className="flex items-center justify-end gap-1">
              {canWrite && isOpen && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Marcar cobrado"
                    title="Marcar cobrado"
                    onClick={() => transition(c.id, "cashed", "Cobrado")}
                  >
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Marcar rechazado"
                    title="Marcar rechazado"
                    onClick={() => transition(c.id, "rejected", "Rechazado")}
                  >
                    <XCircle className="size-4 text-red-600" />
                  </Button>
                  <EditIssuedCheckDialog check={c} accounts={accounts} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Anular"
                    title="Anular"
                    onClick={() => transition(c.id, "cancelled", "Anulado")}
                  >
                    <Ban className="size-4" />
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ];
  }, [accounts, canWrite, confirm, transitionMut]);

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewIssuedCheckDialog accounts={accounts} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={checks}
        getRowId={(c) => c.id}
        emptyMessage="Todavía no hay cheques propios cargados."
        wrapperClassName="mt-4"
      />
    </>
  );
}
