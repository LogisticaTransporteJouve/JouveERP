"use client";

import {
  CalendarClock,
  CheckCircle2,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Receipt,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
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

import { useDeleteShipment, useShipments } from "../hooks/use-shipments";
import { type Shipment, type ShipmentStatus } from "../schema";

import { FreightInvoiceDialog } from "./freight-invoice-dialog";
import { ShipmentDialog } from "./shipment-dialog";
import { ShipmentHistoryDialog } from "./shipment-history-dialog";
import { ShipmentStatusBadge } from "./shipment-status";
import {
  ShipmentStatusDialog,
  type ShipmentStatusAction,
} from "./shipment-status-dialog";

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR");
}

function formatRoute(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

const STATUS_ACTIONS: Record<ShipmentStatus, ShipmentStatusAction[]> = {
  not_started: ["start", "deliver", "cancel", "reprogram"],
  in_progress: ["deliver", "cancel", "reprogram"],
  delivered: [],
  cancelled: ["reprogram"],
  reprogrammed: ["reprogram"],
};

const ACTION_LABEL: Record<ShipmentStatusAction, string> = {
  start: "Iniciar",
  deliver: "Entregar",
  cancel: "Cancelar",
  reprogram: "Reprogramar",
};

const ACTION_ICON: Record<
  ShipmentStatusAction,
  typeof Play
> = {
  start: Play,
  deliver: CheckCircle2,
  cancel: XCircle,
  reprogram: CalendarClock,
};

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; shipment: Shipment }
  | null;

type StatusState = {
  shipment: Shipment;
  action: ShipmentStatusAction;
} | null;

export function ShipmentsTable() {
  const { data: items } = useShipments();
  const deleteMut = useDeleteShipment();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [statusDialog, setStatusDialog] = useState<StatusState>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [freightShipment, setFreightShipment] = useState<Shipment | null>(null);

  const columns = useMemo<ColumnDef<Shipment>[]>(() => {
    async function handleDelete(s: Shipment) {
      const ok = await confirm({
        title: "Borrar carga",
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(s.id, {
        onSuccess: () => toast.success("Carga borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "client",
        header: "Cliente",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.client?.legal_name ?? "—"}
          </span>
        ),
      },
      {
        id: "route",
        header: "Ruta",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {formatRoute(row.original.origin, row.original.destination)}
          </span>
        ),
      },
      {
        accessorKey: "scheduled_date",
        header: "Fecha programada",
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDate(row.original.scheduled_date)}
          </span>
        ),
        meta: { headerClassName: "w-36" },
      },
      {
        accessorKey: "trip",
        header: "Viaje",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.trip?.trip_date ?? "Sin asignar"}
          </span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => <ShipmentStatusBadge status={row.original.status} />,
        meta: { headerClassName: "w-36" },
      },
      {
        accessorKey: "freight_amount",
        header: "Flete",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm">
              {formatMoney(row.original.freight_amount)}
            </span>
            {row.original.invoice_id && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5" />
                Facturado
              </span>
            )}
          </div>
        ),
        meta: { align: "right", headerClassName: "w-40" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => {
          const shipment = row.original;
          const statusActions = STATUS_ACTIONS[shipment.status];
          const canInvoiceFreight = Boolean(
            shipment.freight_amount &&
              shipment.client_id &&
              !shipment.invoice_id,
          );
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setDialog({ mode: "edit", shipment })}
                >
                  <Pencil className="size-4" />
                  Editar
                </DropdownMenuItem>
                {statusActions.length > 0 && <DropdownMenuSeparator />}
                {statusActions.map((action) => {
                  const Icon = ACTION_ICON[action];
                  return (
                    <DropdownMenuItem
                      key={action}
                      className={action === "cancel" ? "text-destructive" : ""}
                      onClick={() => setStatusDialog({ shipment, action })}
                    >
                      <Icon className="size-4" />
                      {ACTION_LABEL[action]}
                    </DropdownMenuItem>
                  );
                })}
                {canInvoiceFreight && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setFreightShipment(shipment)}
                    >
                      <Receipt className="size-4" />
                      Facturar flete
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHistoryId(shipment.id)}>
                  <History className="size-4" />
                  Historial
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(shipment)}
                >
                  <Trash2 className="size-4" />
                  Borrar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [confirm, deleteMut]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cargas</h1>
          <p className="text-sm text-muted-foreground">
            Cargas a transportar con cliente, ruta, viaje y estado de entrega.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nueva carga
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(s) => s.id}
        emptyMessage="Sin cargas. Creá la primera."
      />

      {dialog && (
        <ShipmentDialog
          mode={dialog.mode}
          shipment={dialog.mode === "edit" ? dialog.shipment : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      <ShipmentStatusDialog
        shipment={statusDialog?.shipment ?? null}
        action={statusDialog?.action ?? null}
        onClose={() => setStatusDialog(null)}
      />

      <ShipmentHistoryDialog
        shipmentId={historyId}
        onClose={() => setHistoryId(null)}
      />

      <FreightInvoiceDialog
        shipment={freightShipment}
        onClose={() => setFreightShipment(null)}
      />
    </>
  );
}
