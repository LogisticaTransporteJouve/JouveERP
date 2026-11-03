"use client";

import {
  CalendarRange,
  CheckCircle2,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
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
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  useCancelFreightSettlement,
  useConfirmFreightSettlement,
  useFreightSettlement,
  useFreightSettlements,
} from "../hooks/use-freight-settlements";
import {
  FREIGHT_SETTLEMENT_STATUS_LABELS,
  formatSettlementNumber,
  type FreightSettlement,
} from "../schema";

import { BulkFreightSettlementsDialog } from "./bulk-freight-settlements-dialog";
import { FreightSettlementDetailDialog } from "./freight-settlement-detail-dialog";
import { FreightSettlementDialog } from "./freight-settlement-dialog";
import { FreightSettlementInvoiceDialog } from "./freight-settlement-invoice-dialog";

const INVOICE_STATUS_NOTE: Record<string, string> = {
  draft: "factura en cola",
  emitting: "emitiendo factura",
  emitted: "factura emitida",
};

function statusLabel(s: FreightSettlement): string {
  const base = FREIGHT_SETTLEMENT_STATUS_LABELS[s.status];
  if (s.invoicing) return `${base} · facturando…`;
  if (s.status === "invoiced" && s.invoice_status) {
    const note = INVOICE_STATUS_NOTE[s.invoice_status];
    return note ? `${base} · ${note}` : base;
  }
  return base;
}

/** The draft being edited: its detail loads before the dialog opens. */
function EditDraft({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useFreightSettlement(id);
  const failed = detail.isError ? detail.error.message : null;
  useEffect(() => {
    if (failed === null) return;
    toast.error(failed);
    onClose();
  }, [failed, onClose]);
  if (!detail.data) return null;
  return (
    <FreightSettlementDialog
      settlement={detail.data}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    />
  );
}

export function FreightSettlementsPage({
  canWrite,
  canEmail,
}: {
  canWrite: boolean;
  /** email:send: the R goes to the client by email. */
  canEmail: boolean;
}) {
  const { data: items } = useFreightSettlements();
  const confirmMut = useConfirmFreightSettlement();
  const cancelMut = useCancelFreightSettlement();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState<FreightSettlement | null>(null);

  const columns = useMemo<ColumnDef<FreightSettlement>[]>(() => {
    async function handleConfirm(s: FreightSettlement) {
      const ok = await confirm({
        title: "Confirmar liquidación",
        description:
          "Se recalculan los precios con el flete o la tarifa vigente, se le asigna su número R y ya no se puede editar.",
        confirmLabel: "Confirmar",
      });
      if (!ok) return;
      confirmMut.mutate(s.id, {
        onSuccess: (data) =>
          toast.success(
            `Liquidación ${formatSettlementNumber(data.numero)} confirmada.`,
          ),
        onError: (err) => toast.error(err.message),
      });
    }

    async function handleCancel(s: FreightSettlement) {
      const ok = await confirm({
        title: "Cancelar liquidación",
        description:
          s.status === "invoiced"
            ? "Solo se puede si la factura está anulada o acreditada por nota de crédito por el total. Sus cargas quedan libres."
            : "Sus cargas quedan libres para otra liquidación.",
        confirmLabel: "Cancelar liquidación",
        tone: "destructive",
      });
      if (!ok) return;
      cancelMut.mutate(s.id, {
        onSuccess: () => toast.success("Liquidación cancelada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "numero",
        header: "Número",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {formatSettlementNumber(row.original.numero)}
          </span>
        ),
        meta: { headerClassName: "w-36", mobile: "secondary" },
      },
      {
        accessorKey: "client_name",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.client_name}</span>
        ),
        meta: { mobile: "primary" },
      },
      {
        id: "period",
        header: "Período",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {formatArgentineDate(row.original.period_start)} al{" "}
            {formatArgentineDate(row.original.period_end)}
          </span>
        ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <span className="text-sm">{statusLabel(row.original)}</span>
        ),
        meta: { mobile: "primary" },
      },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {formatMoney(row.original.total)}
          </span>
        ),
        meta: { align: "right", headerClassName: "w-36", mobile: "primary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => {
          const s = row.original;
          const canEdit = canWrite && s.status === "draft";
          const canInvoice =
            canWrite && s.status === "confirmed" && !s.invoicing;
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
                {s.numero !== null && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`/api/freight-settlements/${s.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText className="size-4" />
                      Ver R (PDF)
                    </a>
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setEditId(s.id)}>
                      <Pencil className="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleConfirm(s)}>
                      <CheckCircle2 className="size-4" />
                      Confirmar
                    </DropdownMenuItem>
                  </>
                )}
                {canInvoice && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setInvoicing(s)}>
                      <Receipt className="size-4" />
                      Facturar
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Liquidaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Cargas entregadas de un cliente en un período, en un documento R y
            una sola factura.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBulk(true)}>
              <CalendarRange />
              Liquidar período
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Nueva liquidación
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(s) => s.id}
        emptyMessage="Sin liquidaciones. Armá la primera."
      />

      <FreightSettlementDialog open={creating} onOpenChange={setCreating} />
      {canWrite && (
        <BulkFreightSettlementsDialog open={bulk} onOpenChange={setBulk} />
      )}
      {editId && <EditDraft id={editId} onClose={() => setEditId(null)} />}
      <FreightSettlementDetailDialog
        id={detailId}
        canEmail={canEmail}
        onClose={() => setDetailId(null)}
      />
      <FreightSettlementInvoiceDialog
        settlement={invoicing}
        onClose={() => setInvoicing(null)}
      />
    </>
  );
}
