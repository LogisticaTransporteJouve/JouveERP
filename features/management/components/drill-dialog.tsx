"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";

import { useManagementDrill } from "../hooks/use-management";
import { money, monthLabel } from "../lib/format";
import {
  DOC_TYPE_LABEL,
  DRILL_LIMIT,
  type ManagementBasis,
  type SideView,
} from "../schema";

/** The figure a click opens: a line of the month table, a month (or the
 *  whole year) and a side, under the screen's cost-center filter. */
export type DrillCell = {
  lineKey: string;
  lineLabel: string;
  fromPeriod: string;
  toPeriod: string;
  side: SideView;
  /** The figure as the table shows it (with inflation if it is on). */
  amount: number;
};

const SIDE_LABEL: Record<SideView, string> = {
  total: "fiscal + interno",
  fiscal: "fiscal",
  internal: "interno",
};

export function DrillDialog({
  cell,
  basis,
  inflation,
  costCenter,
  onClose,
}: {
  cell: DrillCell | null;
  basis: ManagementBasis;
  inflation: boolean;
  costCenter: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={cell !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        {cell && (
          <>
            <DialogHeader>
              <DialogTitle>{cell.lineLabel}</DialogTitle>
              <DialogDescription>
                {cell.fromPeriod === cell.toPeriod
                  ? monthLabel(cell.fromPeriod)
                  : `${monthLabel(cell.fromPeriod)} a ${monthLabel(cell.toPeriod)}`}{" "}
                · {SIDE_LABEL[cell.side]} · {money(cell.amount)}. Los
                comprobantes y movimientos detrás de la cifra.
              </DialogDescription>
            </DialogHeader>
            <DrillBody
              cell={cell}
              basis={basis}
              inflation={inflation}
              costCenter={costCenter}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DrillBody({
  cell,
  basis,
  inflation,
  costCenter,
}: {
  cell: DrillCell;
  basis: ManagementBasis;
  inflation: boolean;
  costCenter: string;
}) {
  const { data, error, isPending } = useManagementDrill({
    fromPeriod: cell.fromPeriod,
    toPeriod: cell.toPeriod,
    basis,
    lineKey: cell.lineKey,
    side: cell.side,
    costCenter,
  });

  if (isPending) return <Skeleton className="h-48 w-full" />;
  if (error) {
    return (
      <p role="alert" className="text-sm">
        {error.message}
      </p>
    );
  }
  if (data.count === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin documentos para esta cifra.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {(inflation || data.partial || data.count > data.documents.length) && (
        <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            {inflation && (
              <p>
                Importes nominales (sin ajuste por inflación): suman{" "}
                {money(data.total)}.
              </p>
            )}
            {data.partial && (
              <p>
                Hay demasiados documentos para leerlos todos: la lista y su
                total están incompletos. Elegí un mes o un centro de costo.
              </p>
            )}
            {data.count > data.documents.length && (
              <p>
                Se muestran los {DRILL_LIMIT} de mayor importe de {data.count}.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">Fecha</th>
              <th className="px-2 py-2 text-left">Documento</th>
              <th className="px-2 py-2 text-left">Contraparte</th>
              <th className="px-2 py-2 text-left">Lado</th>
              <th className="px-2 py-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {data.documents.map((d) => (
              <tr
                key={`${d.docType}:${d.docId}:${d.month}:${d.side}`}
                className="border-t"
              >
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {d.docDate
                    ? formatArgentineDate(d.docDate)
                    : monthLabel(d.month)}
                </td>
                <td className="px-2 py-1.5">
                  <span className="block text-muted-foreground">
                    {DOC_TYPE_LABEL[d.docType]}
                  </span>
                  {d.href ? (
                    <Link
                      href={d.href}
                      className="underline underline-offset-2"
                    >
                      {d.label}
                    </Link>
                  ) : (
                    d.label
                  )}
                </td>
                <td className="px-2 py-1.5">{d.counterparty ?? "—"}</td>
                <td className="px-2 py-1.5">
                  {d.side === "fiscal" ? "Fiscal" : "Interno"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                  {d.pendingUsd !== 0 && d.amount === 0
                    ? `US$${formatNumber2(d.pendingUsd)} sin pasar a pesos`
                    : money(d.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-2 py-1.5" colSpan={4}>
                Total ({data.count}{" "}
                {data.count === 1 ? "documento" : "documentos"})
              </td>
              <td className="px-2 py-1.5 text-right font-mono">
                {money(data.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
