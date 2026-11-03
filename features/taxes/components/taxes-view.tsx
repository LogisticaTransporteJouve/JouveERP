"use client";

import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Copy,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Undo2,
  Wallet,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatArgentineDate,
  formatMoney,
  formatPeriod,
  todayInAR,
} from "@/lib/format";

import {
  useCopyTaxDocuments,
  useSetTaxDocumentStatus,
  useTaxDocuments,
} from "../hooks/use-tax-documents";
import {
  isOpenTaxStatus,
  isTaxDocumentOverdue,
  previousPeriod,
  TAX_STATUS_LABEL,
  taxDocumentLabel,
  type TaxDocument,
} from "../schema";

import { PayTaxDocumentDialog } from "./pay-tax-document-dialog";
import { TaxCalendar } from "./tax-calendar";
import { TaxDocumentDialog } from "./tax-document-dialog";

export function TaxesView({
  initialYear,
  canWrite,
  canAttach,
  payAccountOptions,
}: {
  initialYear: number;
  canWrite: boolean;
  canAttach: boolean;
  payAccountOptions: { id: string; name: string }[];
}) {
  const today = todayInAR();
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<TaxDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<TaxDocument | null>(null);
  const copyMut = useCopyTaxDocuments();
  const confirm = useConfirm();

  const years = useMemo(() => {
    const current = Number(today.slice(0, 4));
    return [current + 1, current, current - 1, current - 2];
  }, [today]);

  async function copyPrevious() {
    // The month being declared now: last month's taxes.
    const period = previousPeriod(today.slice(0, 7));
    const ok = await confirm({
      title: `Preparar los impuestos de ${formatPeriod(period)}`,
      description: `Crea los mismos impuestos que hubo en ${formatPeriod(
        previousPeriod(period),
      )}, sin importe y con el vencimiento un mes después. Los que ya están cargados no se duplican.`,
      confirmLabel: "Preparar",
    });
    if (!ok) return;
    copyMut.mutate(
      { period },
      {
        onSuccess: (r) =>
          toast.success(
            r.created === 0
              ? "No había nada nuevo para preparar."
              : `${r.created} impuesto${r.created === 1 ? "" : "s"} preparado${r.created === 1 ? "" : "s"}.`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Impuestos</h1>
          <p className="text-muted-foreground text-sm">
            Cada obligación es un documento con período, vencimiento, importe y
            estado. Pagarlo registra el egreso en caja y su asiento.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={copyPrevious}
              disabled={copyMut.isPending}
            >
              <Copy />
              Preparar el mes
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Nuevo impuesto
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="list">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="list">
              <List />
              Lista
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays />
              Calendario
            </TabsTrigger>
          </TabsList>
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
          >
            <SelectTrigger className="w-28" aria-label="Año">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TaxesContent
            year={year}
            month={month}
            today={today}
            canWrite={canWrite}
            onMonthChange={(m) => {
              setMonth(m);
              setYear(Number(m.slice(0, 4)));
            }}
            onEdit={setEditing}
            onPay={setPaying}
          />
        </Suspense>
      </Tabs>

      {canWrite && (
        <>
          <TaxDocumentDialog
            open={creating || editing !== null}
            onOpenChange={(open) => {
              if (!open) {
                setCreating(false);
                setEditing(null);
              }
            }}
            doc={editing}
            canAttach={canAttach}
          />
          <PayTaxDocumentDialog
            doc={paying}
            accountOptions={payAccountOptions}
            onClose={() => setPaying(null)}
          />
        </>
      )}
    </div>
  );
}

function TaxesContent({
  year,
  month,
  today,
  canWrite,
  onMonthChange,
  onEdit,
  onPay,
}: {
  year: number;
  month: string;
  today: string;
  canWrite: boolean;
  onMonthChange: (month: string) => void;
  onEdit: (doc: TaxDocument) => void;
  onPay: (doc: TaxDocument) => void;
}) {
  const { data: docs } = useTaxDocuments(year);
  const statusMut = useSetTaxDocumentStatus();
  const confirm = useConfirm();

  const columns = useMemo<ColumnDef<TaxDocument>[]>(() => {
    function changeStatus(
      doc: TaxDocument,
      status: "pendiente" | "liquidado" | "anulado",
      success: string,
    ) {
      statusMut.mutate(
        { id: doc.id, status },
        {
          onSuccess: () => toast.success(success),
          onError: (err) => toast.error(err.message),
        },
      );
    }
    async function annul(doc: TaxDocument) {
      const ok = await confirm({
        title: `Anular ${taxDocumentLabel(doc)} de ${formatPeriod(doc.period)}`,
        description:
          "Queda anulado y sale del calendario y de las tareas. No se puede deshacer; si hace falta, cargalo de nuevo.",
        confirmLabel: "Anular",
        tone: "destructive",
      });
      if (ok) changeStatus(doc, "anulado", "Impuesto anulado.");
    }

    return [
      {
        id: "label",
        header: "Impuesto",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="font-medium">
              {taxDocumentLabel(row.original)}
            </span>
            {row.original.kind !== "otro" && row.original.title && (
              <span className="text-muted-foreground ml-1 text-xs">
                {row.original.title}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "period",
        header: "Período",
        meta: { mobile: "secondary", cellClassName: "text-sm" },
        cell: ({ row }) => formatPeriod(row.original.period),
      },
      {
        accessorKey: "due_date",
        header: "Vence",
        meta: { mobile: "primary", cellClassName: "text-sm" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {formatArgentineDate(row.original.due_date)}
            {isTaxDocumentOverdue(row.original, today) && (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium">
                <AlertTriangle className="size-3" />
                Vencido
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: "Importe",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) =>
          row.original.amount === null ? (
            <span className="text-muted-foreground text-sm">Sin liquidar</span>
          ) : (
            <span className="font-mono tabular-nums">
              {formatMoney(row.original.amount)}
              {row.original.amount_is_estimate && (
                <span className="text-muted-foreground ml-1 font-sans text-[10px]">
                  (estimado)
                </span>
              )}
            </span>
          ),
      },
      {
        id: "status",
        header: "Estado",
        enableSorting: false,
        meta: { mobile: "primary", headerClassName: "w-28" },
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === "pagado" ||
              row.original.status === "anulado"
                ? "outline"
                : "secondary"
            }
          >
            {TAX_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "payment",
        header: "Pago",
        enableSorting: false,
        meta: { mobile: "secondary", cellClassName: "text-sm" },
        cell: ({ row }) =>
          row.original.paid_date ? (
            <span>
              {formatArgentineDate(row.original.paid_date)}
              {row.original.paid_from && (
                <>
                  {" · "}
                  <Link href="/transactions" className="hover:underline">
                    {row.original.paid_from}
                  </Link>
                </>
              )}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => {
          const doc = row.original;
          if (!canWrite || doc.status === "anulado") return null;
          const open = isOpenTaxStatus(doc.status);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Acciones">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(doc)}>
                  <Pencil className="size-4" />
                  {open ? "Editar y adjuntar" : "Notas y adjuntos"}
                </DropdownMenuItem>
                {open && (
                  <DropdownMenuItem onClick={() => onPay(doc)}>
                    <Wallet className="size-4" />
                    Pagar
                  </DropdownMenuItem>
                )}
                {doc.status === "pendiente" && (
                  <DropdownMenuItem
                    onClick={() =>
                      changeStatus(doc, "liquidado", "Marcado como liquidado.")
                    }
                  >
                    <CheckCheck className="size-4" />
                    Marcar liquidado
                  </DropdownMenuItem>
                )}
                {doc.status === "liquidado" && (
                  <DropdownMenuItem
                    onClick={() =>
                      changeStatus(doc, "pendiente", "Volvió a pendiente.")
                    }
                  >
                    <Undo2 className="size-4" />
                    Volver a pendiente
                  </DropdownMenuItem>
                )}
                {open && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => annul(doc)}
                  >
                    <Ban className="size-4" />
                    Anular
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [canWrite, confirm, onEdit, onPay, statusMut, today]);

  const visible = docs.filter((d) => d.status !== "anulado");
  const annulled = docs.length - visible.length;

  return (
    <>
      <TabsContent value="list" className="space-y-2">
        <DataTable
          columns={columns}
          data={visible}
          getRowId={(d) => d.id}
          emptyMessage={
            canWrite
              ? "Sin impuestos este año. Cargá el primero o prepará el mes."
              : "Sin impuestos este año."
          }
        />
        {annulled > 0 && (
          <p className="text-muted-foreground text-xs">
            {annulled} anulado{annulled === 1 ? "" : "s"} sin mostrar.
          </p>
        )}
      </TabsContent>
      <TabsContent value="calendar">
        <TaxCalendar
          docs={docs}
          month={month}
          today={today}
          onMonthChange={onMonthChange}
          onSelect={(doc) => {
            if (canWrite && doc.status !== "anulado") onEdit(doc);
          }}
        />
      </TabsContent>
    </>
  );
}
