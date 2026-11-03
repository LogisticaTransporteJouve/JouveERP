"use client";

import {
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
  hasRDocument,
  settlementNextStep,
  settlementNumberLabel,
  settlementSide,
  type FreightSettlement,
} from "../schema";

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
  const internal = settlementSide(s) === "internal";
  if (s.invoicing) {
    return `${base} · ${internal ? "emitiendo remito interno…" : "facturando…"}`;
  }
  if (s.status === "invoiced" && internal) return `${base} · remito interno`;
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

export function FreightSettlementsPage({ canWrite }: { canWrite: boolean }) {
  const { data: items } = useFreightSettlements();
  const confirmMut = useConfirmFreightSettlement();
  const cancelMut = useCancelFreightSettlement();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState<FreightSettlement | null>(null);

  const columns = useMemo<ColumnDef<FreightSettlement>[]>(() => {
    async function handleConfirm(s: FreightSettlement) {
      const ok = await confirm({
        title: "Confirmar liquidación",
        description:
          "Se recalculan los precios con el flete o la tarifa vigente, se emite el Remito R con su número y ya no se puede editar. Después se factura.",
        confirmLabel: "Confirmar",
      });
      if (!ok) return;
      confirmMut.mutate(s.id, {
        onSuccess: (data) =>
          toast.success(
            data.number
              ? `Liquidación confirmada: Remito ${data.number}.`
              : "Liquidación confirmada.",
          ),
        onError: (err) => toast.error(err.message),
      });
    }

    async function handleCancel(s: FreightSettlement) {
      const ok = await confirm({
        title: "Cancelar liquidación",
        description:
          s.status === "invoiced"
            ? settlementSide(s) === "internal"
              ? "Solo se puede si el remito interno está anulado o acreditado por nota de crédito interna por el total. Sus cargas quedan libres."
              : "Solo se puede si la factura está anulada o acreditada por nota de crédito por el total. Sus cargas quedan libres. El Remito R queda cancelado con su número."
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
            {settlementNumberLabel(row.original)}
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
          const step = canWrite && !s.invoicing ? settlementNextStep(s) : null;
          const canCancel = canWrite && s.status !== "cancelled";
          const internalPdf =
            !hasRDocument(s) && s.invoice_number !== null && s.invoice_id;
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
                {hasRDocument(s) && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`/api/freight-settlements/${s.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText className="size-4" />
                      {s.remito_number !== null
                        ? "Ver remito R (PDF)"
                        : "Ver R (PDF)"}
                    </a>
                  </DropdownMenuItem>
                )}
                {internalPdf && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`/api/invoices/${s.invoice_id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText className="size-4" />
                      Ver remito interno (PDF)
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
                  </>
                )}
                {step === "confirm" && (
                  <DropdownMenuItem onClick={() => handleConfirm(s)}>
                    <CheckCircle2 className="size-4" />
                    Confirmar y emitir remito R
                  </DropdownMenuItem>
                )}
                {(step === "invoice" || step === "issue_internal") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setInvoicing(s)}>
                      <Receipt className="size-4" />
                      {step === "invoice"
                        ? "Facturar"
                        : "Emitir remito interno"}
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
            Cargas entregadas de un cliente en un período: en Ventas, un Remito
            R y una sola factura; en Otras ventas, un remito interno.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Nueva liquidación
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(s) => s.id}
        emptyMessage="Sin liquidaciones. Armá la primera."
      />

      <FreightSettlementDialog open={creating} onOpenChange={setCreating} />
      {editId && <EditDraft id={editId} onClose={() => setEditId(null)} />}
      <FreightSettlementDetailDialog
        id={detailId}
        onClose={() => setDetailId(null)}
      />
      <FreightSettlementInvoiceDialog
        settlement={invoicing}
        onClose={() => setInvoicing(null)}
      />
    </>
  );
}
