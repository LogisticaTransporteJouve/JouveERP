"use client";

import {
  CheckCircle2,
  Eye,
  HandCoins,
  MoreHorizontal,
  Pencil,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
} from "@/lib/format";

import {
  useCancelDriverSettlement,
  useCodPending,
  useConfirmDriverSettlement,
  useDriverSettlement,
  useDriverSettlements,
} from "../hooks/use-driver-settlements";
import {
  DRIVER_SETTLEMENT_STATUS_LABELS,
  formatDriverSettlementNumber,
  type CodPendingByDriver,
  type DriverSettlement,
} from "../schema";

import { DriverSettlementDetailDialog } from "./driver-settlement-detail-dialog";
import { DriverSettlementDialog } from "./driver-settlement-dialog";

type Editing =
  | { mode: "create"; driver: { id: string; name: string } }
  | { mode: "edit"; id: string; driver: { id: string; name: string } }
  | null;

/** The draft being edited: its detail loads before the dialog opens. */
function EditDraft({
  id,
  driver,
  onClose,
}: {
  id: string;
  driver: { id: string; name: string };
  onClose: () => void;
}) {
  const detail = useDriverSettlement(id);
  const { data: pending } = useCodPending();
  const failed = detail.isError ? detail.error.message : null;
  useEffect(() => {
    if (failed === null) return;
    toast.error(failed);
    onClose();
  }, [failed, onClose]);
  if (!detail.data) return null;
  return (
    <DriverSettlementDialog
      driver={driver}
      pending={pending.shipments.filter((s) => s.driver_id === driver.id)}
      settlement={detail.data}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    />
  );
}

export function DriverSettlementsPage({ canWrite }: { canWrite: boolean }) {
  const { data: settlements } = useDriverSettlements();
  const { data: pending } = useCodPending();
  const confirmMut = useConfirmDriverSettlement();
  const cancelMut = useCancelDriverSettlement();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const pendingColumns = useMemo<ColumnDef<CodPendingByDriver>[]>(
    () => [
      {
        accessorKey: "driver_name",
        header: "Chofer",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.driver_name}</span>
        ),
        meta: { mobile: "primary" },
      },
      {
        accessorKey: "cargas",
        header: "Cargas por rendir",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.cargas}</span>
        ),
        meta: { align: "right", mobile: "secondary" },
      },
      {
        accessorKey: "amount",
        header: "A rendir",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {formatMoney(row.original.amount)}
          </span>
        ),
        meta: { align: "right", mobile: "primary" },
      },
      {
        accessorKey: "drafts",
        header: "Borradores",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.drafts}</span>
        ),
        meta: { align: "right", mobile: "secondary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-28", mobile: "primary" },
        cell: ({ row }) => {
          const d = row.original;
          if (!canWrite || d.driver_id === null || d.cargas === 0) return null;
          const driverId = d.driver_id;
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEditing({
                  mode: "create",
                  driver: { id: driverId, name: d.driver_name },
                })
              }
            >
              <HandCoins />
              Rendir
            </Button>
          );
        },
      },
    ],
    [canWrite],
  );

  const columns = useMemo<ColumnDef<DriverSettlement>[]>(() => {
    async function handleConfirm(s: DriverSettlement) {
      const ok = await confirm({
        title: "Confirmar rendición",
        description: `Se emiten los recibos por ${formatMoney(s.received_total)} (uno por cliente) y entran a caja, bancos o cartera. Después no se puede editar.`,
        confirmLabel: "Confirmar",
      });
      if (!ok) return;
      confirmMut.mutate(s.id, {
        onSuccess: (data) =>
          toast.success(
            data.receiptIds.length === 1
              ? "Rendición confirmada: se emitió 1 recibo."
              : `Rendición confirmada: se emitieron ${data.receiptIds.length} recibos.`,
          ),
        onError: (err) => toast.error(err.message),
      });
    }

    async function handleCancel(s: DriverSettlement) {
      const ok = await confirm({
        title: "Cancelar rendición",
        description:
          s.status === "confirmed"
            ? "Solo se puede si sus recibos ya están anulados (en Recibos). Sus cargas vuelven a quedar por rendir."
            : "Sus cargas vuelven a quedar por rendir.",
        confirmLabel: "Cancelar rendición",
        tone: "destructive",
      });
      if (!ok) return;
      cancelMut.mutate(s.id, {
        onSuccess: () => toast.success("Rendición cancelada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "numero",
        header: "Número",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {formatDriverSettlementNumber(row.original.numero)}
          </span>
        ),
        meta: { headerClassName: "w-28", mobile: "secondary" },
      },
      {
        accessorKey: "driver_name",
        header: "Chofer",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.driver_name}</span>
        ),
        meta: { mobile: "primary" },
      },
      {
        accessorKey: "settlement_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="text-sm">
            {formatArgentineDate(row.original.settlement_date)}
          </span>
        ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => {
          const s = row.original;
          const anulled =
            s.status === "confirmed" &&
            s.receipts.length > 0 &&
            s.receipts.every((r) => r.canceled);
          return (
            <span className="text-sm">
              {DRIVER_SETTLEMENT_STATUS_LABELS[s.status]}
              {anulled ? " · recibos anulados" : ""}
            </span>
          );
        },
        meta: { mobile: "primary" },
      },
      {
        accessorKey: "received_total",
        header: "Entregado",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {formatMoney(row.original.received_total)}
          </span>
        ),
        meta: { align: "right", mobile: "primary" },
      },
      {
        accessorKey: "difference",
        header: "Diferencia",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.difference === 0
              ? "—"
              : formatMoneySigned(row.original.difference)}
          </span>
        ),
        meta: { align: "right", mobile: "secondary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => {
          const s = row.original;
          const isDraft = canWrite && s.status === "draft";
          const canCancel = canWrite && s.status !== "cancelled";
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Acciones">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDetailId(s.id)}>
                  <Eye className="size-4" />
                  Ver
                </DropdownMenuItem>
                {isDraft && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        setEditing({
                          mode: "edit",
                          id: s.id,
                          driver: { id: s.driver_id, name: s.driver_name },
                        })
                      }
                    >
                      <Pencil className="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleConfirm(s)}>
                      <CheckCircle2 className="size-4" />
                      Confirmar
                    </DropdownMenuItem>
                  </>
                )}
                {canCancel && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleCancel(s)}
                    >
                      <XCircle className="size-4" />
                      Cancelar
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [canWrite, confirm, confirmMut, cancelMut]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rendiciones</h1>
        <p className="text-sm text-muted-foreground">
          Cobranza contra entrega: lo que cada chofer cobró al entregar y lo que
          entregó.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Pendientes por chofer</h2>
        <DataTable
          columns={pendingColumns}
          data={pending.byDriver}
          getRowId={(d) => d.driver_id ?? "none"}
          emptyMessage="Ningún chofer tiene cobranzas por rendir."
        />
        {pending.byDriver.some((d) => d.driver_id === null) && (
          <p className="text-xs text-muted-foreground">
            &quot;Sin chofer&quot;: cargas contra entrega entregadas sin viaje o
            con un viaje sin chofer. Asignales el viaje para rendirlas.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Rendiciones</h2>
        <DataTable
          columns={columns}
          data={settlements}
          getRowId={(s) => s.id}
          emptyMessage="Sin rendiciones todavía."
        />
      </section>

      {editing?.mode === "create" && (
        <DriverSettlementDialog
          driver={editing.driver}
          pending={pending.shipments.filter(
            (s) => s.driver_id === editing.driver.id,
          )}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
      {editing?.mode === "edit" && (
        <EditDraft
          id={editing.id}
          driver={editing.driver}
          onClose={() => setEditing(null)}
        />
      )}
      <DriverSettlementDetailDialog
        id={detailId}
        onClose={() => setDetailId(null)}
      />
    </>
  );
}
