"use client";

import { FilePlus2, Files, MoreHorizontal, Percent } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { formatArgentineDate, formatMoney, todayInAR } from "@/lib/format";
import { paymentCurrencyOf } from "@/lib/fx";

import {
  useLateInterestCandidates,
  useLateInterestGeneralRate,
} from "../hooks/use-late-interest";
import { comprobanteLabel } from "../lib/late-interest";
import type { LateInterestCandidate } from "../schema";

import {
  BulkLateInterestDialog,
  bulkEligible,
} from "./bulk-late-interest-dialog";
import { IssueLateInterestDialog } from "./issue-late-interest-dialog";
import {
  LateInterestRateDialog,
  type RateTarget,
} from "./late-interest-rate-dialog";

function rateLabel(c: LateInterestCandidate): string {
  if (c.monthly_rate === null) return "Sin tasa";
  return `${c.monthly_rate}%${c.client_rate === null ? " (general)" : ""}`;
}

/**
 * Intereses por mora: the overdue comprobantes with open balance and the
 * interest their next ND would charge up to the chosen date. Nothing is
 * charged until the user generates the ND of a row.
 */
export function LateInterestPage({
  initialAsOf,
  canIssue,
  canSetGeneralRate,
  canSetClientRate,
}: {
  initialAsOf: string;
  canIssue: boolean;
  canSetGeneralRate: boolean;
  canSetClientRate: boolean;
}) {
  const isFiscal = useScopeIsFiscal();
  const [asOf, setAsOf] = useState(initialAsOf);
  const [isPending, startTransition] = useTransition();
  const { data: items } = useLateInterestCandidates(asOf, isFiscal);
  const { data: general } = useLateInterestGeneralRate();
  const [issuing, setIssuing] = useState<LateInterestCandidate | null>(null);
  const [rateTarget, setRateTarget] = useState<RateTarget | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const eligible = items.filter(bulkEligible);
  const today = todayInAR();

  const columns = useMemo<ColumnDef<LateInterestCandidate>[]>(() => {
    const base: ColumnDef<LateInterestCandidate>[] = [
      {
        accessorKey: "client_name",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.client_name}</span>
        ),
        meta: { mobile: "primary" },
      },
      {
        id: "comprobante",
        header: "Comprobante",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {comprobanteLabel(row.original)}
          </span>
        ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "due_date",
        header: "Vencimiento",
        cell: ({ row }) => formatArgentineDate(row.original.due_date),
        meta: { cellClassName: "tabular-nums", mobile: "secondary" },
      },
      {
        accessorKey: "open_amount",
        header: "Saldo",
        cell: ({ row }) =>
          formatMoney(
            row.original.open_amount,
            paymentCurrencyOf(row.original.moneda),
          ),
        meta: { align: "right", cellClassName: "tabular-nums" },
      },
      {
        id: "charged_to",
        header: "Cobrado hasta",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.charged_to
            ? formatArgentineDate(row.original.charged_to)
            : "—",
        meta: { cellClassName: "tabular-nums", mobile: "secondary" },
      },
      {
        accessorKey: "days",
        header: "Días",
        meta: { align: "right", cellClassName: "tabular-nums" },
      },
      {
        id: "rate",
        header: "Tasa mensual",
        enableSorting: false,
        cell: ({ row }) => rateLabel(row.original),
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        accessorKey: "interest",
        header: "Interés",
        cell: ({ row }) =>
          row.original.interest > 0
            ? formatMoney(
                row.original.interest,
                paymentCurrencyOf(row.original.moneda),
              )
            : "—",
        meta: {
          align: "right",
          cellClassName: "tabular-nums",
          mobile: "primary",
        },
      },
    ];
    if (!canIssue && !canSetClientRate) return base;
    return [
      ...base,
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Acciones" variant="ghost">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canIssue && (
                <DropdownMenuItem
                  disabled={row.original.days === 0}
                  onClick={() => setIssuing(row.original)}
                >
                  <FilePlus2 className="size-4" />
                  Generar ND
                </DropdownMenuItem>
              )}
              {canSetClientRate && (
                <DropdownMenuItem
                  onClick={() =>
                    setRateTarget({
                      kind: "client",
                      clientId: row.original.client_id,
                      clientName: row.original.client_name,
                      current: row.original.client_rate,
                    })
                  }
                >
                  <Percent className="size-4" />
                  Tasa del cliente
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  }, [canIssue, canSetClientRate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Label htmlFor="li-as-of">Calcular hasta</Label>
          <DatePicker
            id="li-as-of"
            className="w-44"
            value={asOf}
            max={today}
            onChange={(next) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next <= today) {
                startTransition(() => setAsOf(next));
              }
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canIssue && (
            <Button
              size="sm"
              disabled={eligible.length === 0}
              onClick={() => setBulkOpen(true)}
            >
              <Files />
              Generar varias ND
            </Button>
          )}
          <span className="text-muted-foreground">
            Tasa general:{" "}
            {general.monthly_rate === null
              ? "sin definir"
              : `${general.monthly_rate}% mensual`}
          </span>
          {canSetGeneralRate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRateTarget({
                  kind: "general",
                  current: general.monthly_rate,
                })
              }
            >
              <Percent />
              Cambiar
            </Button>
          )}
        </div>
      </div>

      <div className={isPending ? "opacity-60" : undefined}>
        <DataTable
          columns={columns}
          data={items}
          getRowId={(c) => c.invoice_id}
          emptyMessage="No hay comprobantes vencidos con saldo abierto."
        />
      </div>

      <IssueLateInterestDialog
        candidate={issuing}
        asOf={asOf}
        onClose={() => setIssuing(null)}
      />
      {canIssue && (
        <BulkLateInterestDialog
          open={bulkOpen}
          candidates={eligible}
          asOf={asOf}
          onClose={() => setBulkOpen(false)}
        />
      )}
      <LateInterestRateDialog
        target={rateTarget}
        onClose={() => setRateTarget(null)}
      />
    </div>
  );
}
