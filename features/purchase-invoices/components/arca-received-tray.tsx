"use client";

import {
  AlertTriangle,
  Check,
  Eye,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/file-upload/file-dropzone";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { purchaseOwnTipoLabel } from "@/lib/afip/codes";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  useDiscardReceivedVoucher,
  useReceivedVoucherCounts,
  useReceivedVouchers,
  useRequestArcaSync,
  useRestoreReceivedVoucher,
  useSubmitReceivedVoucher,
  useUploadReceivedExport,
} from "../hooks/use-arca-received";
import {
  arcaVoucherToDraft,
  rawAmountsText,
  receivedGapText,
  receivedVoucherGap,
  unreadableVoucherToDraft,
} from "../lib/arca-received-draft";
import type { PurchaseInvoiceDraft } from "../lib/purchase-invoice-draft";
import {
  RECEIVED_VOUCHER_STATUSES,
  RECEIVED_VOUCHER_TAB_LABEL,
  UNREADABLE_REASON_LABEL,
  formatInvoiceNumber,
  type ReceivedVoucher,
  type ReceivedVoucherStatus,
} from "../schema";
import { ArcaSyncCard } from "./arca-sync-card";
import { ArcaVoucherDetailDialog } from "./arca-voucher-detail";
import { PurchaseInvoiceDraftDialog } from "./purchase-invoice-draft-dialog";

const EMPTY: Record<ReceivedVoucherStatus, string> = {
  pending_review:
    "No hay comprobantes pendientes. Subí el archivo de Mis Comprobantes → Recibidos.",
  confirmed: "Todavía no se cargó ningún comprobante desde ARCA.",
  discarded: "No hay comprobantes descartados.",
  unsupported: "No hay comprobantes de tipos que no se cargan solos.",
  unreadable: "No hay comprobantes que no se hayan podido leer.",
};

function voucherNumber(v: ReceivedVoucher): string {
  // A recibo, liquidación or M loads as an ERP kind but keeps its own name.
  const own = purchaseOwnTipoLabel(v.cbte_tipo);
  if (own) {
    return `${own} ${formatInvoiceNumber({ letter: "", punto_venta: v.punto_venta, numero: v.numero })}`;
  }
  return v.kind
    ? formatInvoiceNumber({
        kind: v.kind,
        letter: v.letter,
        punto_venta: v.punto_venta,
        numero: v.numero,
      })
    : `Tipo ${v.cbte_tipo} · ${formatInvoiceNumber({ letter: "", punto_venta: v.punto_venta, numero: v.numero })}`;
}

function linkedState(v: ReceivedVoucher): string | null {
  if (!v.purchase) return null;
  if (v.purchase.status === "cancelled") return "Anulada";
  if (!v.purchase.is_fiscal) return "Canal interno";
  return null;
}

function AcceptDialog({
  voucher,
  onClose,
}: {
  voucher: ReceivedVoucher;
  onClose: () => void;
}) {
  const submitCreate = useSubmitReceivedVoucher(voucher.id);
  // ARCA's amounts did not read, or its type does not load by itself: the
  // person types them from the invoice.
  const draft = useMemo<PurchaseInvoiceDraft>(
    () =>
      voucher.status === "unreadable" || voucher.status === "unsupported"
        ? {
            origin: "document",
            data: unreadableVoucherToDraft(voucher),
            source: null,
            submitCreate,
          }
        : {
            origin: "arca",
            data: arcaVoucherToDraft(voucher),
            source: null,
            submitCreate,
          },
    [voucher, submitCreate],
  );
  return (
    <PurchaseInvoiceDraftDialog
      draft={draft}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCreated={onClose}
    />
  );
}

function VoucherTable({ status }: { status: ReceivedVoucherStatus }) {
  const { vouchers, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useReceivedVouchers(status);
  const discard = useDiscardReceivedVoucher();
  const restore = useRestoreReceivedVoucher();
  const confirm = useConfirm();
  const retry = useRequestArcaSync();
  const [accepting, setAccepting] = useState<ReceivedVoucher | null>(null);
  const [viewing, setViewing] = useState<ReceivedVoucher | null>(null);

  const discardButton = useCallback(
    (v: ReceivedVoucher) => (
      <IconButton
        label="Descartar"
        variant="ghost"
        disabled={discard.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: "Descartar comprobante",
            description:
              "No se carga como compra. Lo podés recuperar desde Descartadas.",
            confirmLabel: "Descartar",
            tone: "destructive",
          });
          if (!ok) return;
          discard.mutate(
            { voucherId: v.id },
            { onError: (err) => toast.error(err.message) },
          );
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
    ),
    [confirm, discard],
  );

  const columns = useMemo<ColumnDef<ReceivedVoucher>[]>(
    () => [
      {
        accessorKey: "fecha",
        header: "Fecha",
        enableSorting: false,
        meta: { mobile: "secondary", headerClassName: "w-28" },
        cell: ({ row }) => formatArgentineDate(row.original.fecha),
      },
      {
        id: "issuer",
        header: "Proveedor",
        enableSorting: false,
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[14rem] sm:max-w-xs lg:max-w-md">
            <p
              className="truncate font-medium"
              title={
                row.original.supplier?.display_name ??
                row.original.supplier?.legal_name ??
                row.original.issuer_name
              }
            >
              {row.original.supplier?.display_name ??
                row.original.supplier?.legal_name ??
                row.original.issuer_name}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {row.original.issuer_cuit}
              {row.original.supplier ? "" : " · proveedor nuevo"}
            </p>
          </div>
        ),
      },
      {
        id: "numero",
        header: "Comprobante",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => {
          const v = row.original;
          const gap =
            v.kind && !v.unreadable_reason ? receivedVoucherGap(v) : null;
          return (
            <div className="space-y-1">
              <span className="font-mono text-sm">{voucherNumber(v)}</span>
              {v.unreadable_reason && (
                <p className="flex items-start gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {UNREADABLE_REASON_LABEL[v.unreadable_reason] ??
                    "No se pudieron leer los importes"}
                </p>
              )}
              {gap !== null && (
                <p className="flex items-start gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {receivedGapText(gap, v.moneda)}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "total",
        header: "Total",
        enableSorting: false,
        meta: { mobile: "primary", align: "right" },
        cell: ({ row }) =>
          row.original.unreadable_reason ? (
            // Nothing read is trusted: what ARCA listed, as text.
            <span className="ml-auto block max-w-[16rem] whitespace-normal text-right text-xs text-muted-foreground">
              {rawAmountsText(row.original.raw_amounts) || "—"}
            </span>
          ) : (
            <span className="font-mono tabular-nums">
              {formatMoney(
                row.original.imp_total,
                row.original.moneda === "DOL" ? "USD" : "ARS",
              )}
            </span>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { mobile: "primary", align: "right" },
        cell: ({ row }) => {
          const v = row.original;
          const detail = (
            <IconButton
              label="Ver detalle"
              variant="ghost"
              onClick={() => setViewing(v)}
            >
              <Eye className="size-4" />
            </IconButton>
          );
          if (v.status === "pending_review") {
            return (
              <div className="flex justify-end gap-1">
                {detail}
                <Button size="sm" onClick={() => setAccepting(v)}>
                  <Check className="size-4" />
                  Aceptar y cargar
                </Button>
                {discardButton(v)}
              </div>
            );
          }
          if (v.status === "unreadable") {
            return (
              <div className="flex justify-end gap-1">
                <Button size="sm" onClick={() => setAccepting(v)}>
                  <PencilLine className="size-4" />
                  Cargar a mano
                </Button>
                <IconButton
                  label="Volver a intentar"
                  variant="ghost"
                  disabled={retry.isPending}
                  onClick={() => {
                    const month = v.fecha.slice(0, 7);
                    retry.mutate(
                      { fromMonth: month, toMonth: month },
                      {
                        onSuccess: () =>
                          toast.success(
                            "Se lo pido de nuevo a ARCA. Si ahora se puede leer, pasa a Pendientes.",
                          ),
                        onError: (err) => toast.error(err.message),
                      },
                    );
                  }}
                >
                  <RefreshCw className="size-4" />
                </IconButton>
                {discardButton(v)}
              </div>
            );
          }
          if (v.status === "unsupported") {
            return (
              <div className="flex justify-end gap-1">
                {detail}
                <Button size="sm" onClick={() => setAccepting(v)}>
                  <PencilLine className="size-4" />
                  Cargar a mano
                </Button>
                {discardButton(v)}
              </div>
            );
          }
          if (v.status === "discarded") {
            return (
              <div className="flex justify-end gap-1">
                {detail}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(v.id, {
                      onError: (err) => toast.error(err.message),
                    })
                  }
                >
                  <RotateCcw className="size-4" />
                  Volver a pendientes
                </Button>
              </div>
            );
          }
          if (v.status === "confirmed" && v.purchase) {
            const state = linkedState(v);
            return (
              <div className="flex items-center justify-end gap-2">
                {detail}
                {state && <Badge variant="outline">{state}</Badge>}
                <Link
                  href={`/purchases/${v.purchase.id}`}
                  className="text-sm underline underline-offset-2"
                >
                  Ver compra
                </Link>
              </div>
            );
          }
          return <div className="flex justify-end">{detail}</div>;
        },
      },
    ],
    [discardButton, restore, retry],
  );

  return (
    <div className="space-y-3">
      {status === "unsupported" && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Tipos que todavía no se cargan solos (por ejemplo, facturas de crédito
          MiPyME): con «Cargar a mano» elegís la clase y la letra y cargás los
          importes.
        </p>
      )}
      <DataTable
        columns={columns}
        data={vouchers}
        getRowId={(r) => r.id}
        emptyMessage={EMPTY[status]}
      />
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
      {viewing && (
        <ArcaVoucherDetailDialog
          voucher={viewing}
          number={voucherNumber(viewing)}
          onClose={() => setViewing(null)}
        />
      )}
      {accepting && (
        <AcceptDialog voucher={accepting} onClose={() => setAccepting(null)} />
      )}
    </div>
  );
}

function uploadSummary(r: {
  inserted: number;
  unsupported: number;
  alreadyInTray: number;
  linked: number;
  skipped: number;
}): string {
  const notes = [
    r.linked > 0 ? `${r.linked} ya cargados como compra` : null,
    r.unsupported > 0 ? `${r.unsupported} no soportados` : null,
  ].filter((n) => n !== null);
  const parts = [
    `${r.inserted} nuevos${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
    `${r.alreadyInTray} ya estaban en la bandeja`,
  ];
  if (r.skipped > 0) parts.push(`${r.skipped} no se pudieron leer`);
  return parts.join(" · ");
}

export function ArcaReceivedTray() {
  const [status, setStatus] = useState<ReceivedVoucherStatus>("pending_review");
  const upload = useUploadReceivedExport();
  const counts = useReceivedVoucherCounts();
  const pending = counts.data?.pending ?? 0;
  const unreadable = counts.data?.unreadable ?? 0;

  return (
    <div className="space-y-6">
      <ArcaSyncCard
        unreadable={unreadable}
        onShowUnreadable={() => setStatus("unreadable")}
      />

      <FileDropzone
        onFile={(file) =>
          upload.mutate(file, {
            onSuccess: (r) => toast.success(uploadSummary(r)),
            onError: (err) => toast.error(err.message),
          })
        }
        onError={(message) => toast.error(message)}
        fileType="tables"
        disabled={upload.isPending}
        placeholder="O subí el archivo de ARCA → Mis Comprobantes → Recibidos"
        description="CSV, TXT o Excel, tal como lo baja ARCA. Lo que ya está en la bandeja no se duplica."
      />

      <div className="overflow-x-auto">
        <Tabs
          value={status}
          onValueChange={(v) => {
            const next = RECEIVED_VOUCHER_STATUSES.find((s) => s === v);
            if (next) setStatus(next);
          }}
        >
          <TabsList>
            {RECEIVED_VOUCHER_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {RECEIVED_VOUCHER_TAB_LABEL[s]}
                {s === "pending_review" && pending > 0 ? ` (${pending})` : ""}
                {s === "unreadable" && unreadable > 0 ? ` (${unreadable})` : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Suspense
        key={status}
        fallback={<Skeleton className="h-48 w-full rounded-lg" />}
      >
        <VoucherTable status={status} />
      </Suspense>
    </div>
  );
}
