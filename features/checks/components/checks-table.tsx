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
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useChecksList } from "../hooks/use-checks";
import { checksKeys } from "../lib/checks-keys";
import {
  CHECK_KIND_LABEL,
  CHECK_STATUS_LABEL,
  type ChequeStatus,
} from "../schema";
import {
  CreditChequeDialog,
  DepositChequeDialog,
  EndorseChequeDialog,
  RejectChequeDialog,
} from "./check-action-dialogs";
import { NewChequeDialog } from "./new-check-dialog";

const STATUS_TONE: Record<ChequeStatus, string> = {
  en_cartera: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  depositado: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  acreditado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  endosado: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  rechazado: "bg-red-500/15 text-red-700 dark:text-red-300",
};

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});
const usdFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

interface ChannelOption {
  id: string;
  name: string;
}

export function ChequesTable({
  channels,
  actorRoles,
}: {
  channels: ChannelOption[];
  actorRoles: Role[];
}) {
  const { data } = useChecksList();
  const items = data.items;
  const canWrite = userCan(actorRoles, "cheques:write");

  // Realtime: any check change (status flips: depositado, acreditado,
  // endosado, rechazado) refreshes the list for everyone watching.
  useRealtimeInvalidate([
    {
      table: "checks",
      queryKeys: [checksKeys.all],
    },
  ]);

  const totalsByStatus = items.reduce<Record<ChequeStatus, number>>(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + Number(c.amount);
      return acc;
    },
    {
      en_cartera: 0,
      depositado: 0,
      acreditado: 0,
      endosado: 0,
      rechazado: 0,
    },
  );

  return (
    <>
      {/* Summary cards by status */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(STATUS_TONE) as ChequeStatus[]).map((status) => (
          <div
            key={status}
            className="rounded-md border bg-card p-3 text-sm"
          >
            <div className="text-xs text-muted-foreground">
              {CHECK_STATUS_LABEL[status]}
            </div>
            <div className="font-mono text-base font-semibold">
              {arsFmt.format(totalsByStatus[status])}
            </div>
          </div>
        ))}
      </div>

      {canWrite && (
        <div className="flex justify-end">
          <NewChequeDialog />
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Número</TableHead>
              <TableHead>Banco</TableHead>
              <TableHead>Firmante</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[280px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay cheques.
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => {
                const formatter = c.currency === "USD" ? usdFmt : arsFmt;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      {CHECK_KIND_LABEL[c.kind]}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.check_number}
                    </TableCell>
                    <TableCell className="text-sm">{c.bank_name}</TableCell>
                    <TableCell className="text-sm">
                      {c.drawer_name}
                      {c.source_client_legal_name && (
                        <div className="text-xs text-muted-foreground">
                          via {c.source_client_legal_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(c.due_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatter.format(Number(c.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_TONE[c.status]}>
                        {CHECK_STATUS_LABEL[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && c.status === "en_cartera" && (
                          <>
                            <DepositChequeDialog
                              check={c}
                              channels={channels}
                            />
                            <EndorseChequeDialog
                              check={c}
                              channels={channels}
                            />
                            <RejectChequeDialog
                              check={c}
                              channels={channels}
                            />
                          </>
                        )}
                        {canWrite && c.status === "depositado" && (
                          <>
                            <CreditChequeDialog check={c} />
                            <RejectChequeDialog
                              check={c}
                              channels={channels}
                            />
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
