"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { tariffVigencia } from "@/features/storage-tariffs/schema";
import { formatArgentineDate, formatNumber2, todayInAR } from "@/lib/format";

import {
  useClientTariffs,
  useDeleteClientTariff,
} from "../hooks/use-client-tariffs";
import {
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_UNIT_LABELS,
  type ClientTariff,
} from "../schema";

import { ClientTariffDialog } from "./client-tariff-dialog";

const VIGENCIA_LABEL = {
  vigente: "Vigente",
  vencida: "Vencida",
  futura: "Futura",
} as const;

function price(t: ClientTariff): string {
  return `${t.currency === "USD" ? "US$" : "$"}${formatNumber2(t.price)}`;
}

function vigencia(t: ClientTariff): string {
  const from = formatArgentineDate(t.valid_from);
  return t.valid_to
    ? `${from} → ${formatArgentineDate(t.valid_to)}`
    : `Desde ${from}`;
}

/** The client's own prices (almacenaje, carga, descarga, flete) with
 *  vigencia. */
export function ClientTariffsTab({
  clientId,
  canWrite,
}: {
  clientId: string;
  canWrite: boolean;
}) {
  const { data: items } = useClientTariffs(clientId);
  const deleteMut = useDeleteClientTariff();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; tariff: ClientTariff } | null
  >(null);

  const columns = useMemo<ColumnDef<ClientTariff>[]>(() => {
    async function handleDelete(t: ClientTariff) {
      const ok = await confirm({
        title: `Borrar tarifa de ${CLIENT_TARIFF_CONCEPT_LABELS[t.concept].toLowerCase()}`,
        description:
          t.concept === "freight"
            ? "Las cargas sin flete de esos días quedan sin precio para liquidar. Las liquidaciones ya confirmadas no cambian."
            : "En los días que cubría se vuelve a usar la tarifa de almacenaje. Las facturas ya emitidas no cambian.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(t.id, {
        onSuccess: () => toast.success("Tarifa borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    const base: ColumnDef<ClientTariff>[] = [
      {
        accessorKey: "concept",
        header: "Concepto",
        cell: ({ row }) => (
          <span className="font-medium">
            {CLIENT_TARIFF_CONCEPT_LABELS[row.original.concept]}
          </span>
        ),
        meta: { mobile: "primary" },
      },
      {
        id: "price",
        header: "Precio",
        enableSorting: false,
        meta: {
          align: "right",
          cellClassName: "tabular-nums",
          mobile: "primary",
        },
        cell: ({ row }) => (
          <div className="flex flex-col items-end">
            <span>{price(row.original)}</span>
            <span className="text-xs text-muted-foreground">
              {CLIENT_TARIFF_UNIT_LABELS[row.original.unit].toLowerCase()}
            </span>
          </div>
        ),
      },
      {
        id: "validity",
        header: "Vigencia",
        enableSorting: false,
        meta: { cellClassName: "tabular-nums", mobile: "secondary" },
        cell: ({ row }) => vigencia(row.original),
      },
      {
        id: "state",
        header: "Estado",
        enableSorting: false,
        meta: { headerClassName: "w-24", mobile: "secondary" },
        cell: ({ row }) => {
          const state = tariffVigencia(row.original, todayInAR());
          return (
            <Badge
              variant={state === "vigente" ? "secondary" : "outline"}
              className="text-xs font-normal"
            >
              {VIGENCIA_LABEL[state]}
            </Badge>
          );
        },
      },
    ];
    if (!canWrite) return base;
    return [
      ...base,
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Acciones">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  setDialog({ mode: "edit", tariff: row.original })
                }
              >
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={deleteMut.isPending}
                onClick={() => handleDelete(row.original)}
              >
                <Trash2 className="size-4" />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  }, [canWrite, confirm, deleteMut]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Tarifario del cliente</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Precios propios de almacenaje, carga y descarga con vigencia. En los
            días que cubren pisan a las tarifas de almacenaje; en el resto se
            usa la tarifa de almacenaje del cliente o, si no tiene, la general.
            Las tarifas en dólares se convierten con la cotización oficial del
            último día del período facturado (o la anterior más cercana). El
            flete, por carga y en pesos, precia en las liquidaciones las cargas
            que no tienen flete propio.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nueva tarifa
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(t) => t.id}
        emptyMessage="Sin tarifas propias: se factura con la tarifa de almacenaje."
      />

      {dialog && (
        <ClientTariffDialog
          clientId={clientId}
          tariff={dialog.mode === "edit" ? dialog.tariff : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
