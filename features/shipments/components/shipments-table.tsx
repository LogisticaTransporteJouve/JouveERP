"use client";

import {
  CalendarClock,
  CheckCircle2,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ListSearch } from "@/components/list-toolbar";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { userCan, type Access } from "@/lib/auth/permissions";

import { useDeleteShipment, useShipments } from "../hooks/use-shipments";
import { matchesShipmentSearch } from "../lib/format";
import {
  SHIPMENT_NEXT_STATUSES,
  type Shipment,
  type ShipmentStatus,
  type ShipmentTargetStatus,
} from "../schema";

import { ShipmentDialog } from "./shipment-dialog";
import { ShipmentHistoryDialog } from "./shipment-history-dialog";
import { ShipmentStatusBadge } from "./shipment-status";
import {
  ShipmentStatusDialog,
  type ShipmentStatusAction,
} from "./shipment-status-dialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR");
}

// A carga is not started by hand: an «En progreso» one (older data) can still
// be delivered, cancelled or reprogrammed.
const TARGET_ACTION: Record<ShipmentTargetStatus, ShipmentStatusAction | null> =
  {
    in_progress: null,
    delivered: "deliver",
    cancelled: "cancel",
    reprogrammed: "reprogram",
  };

function statusActions(status: ShipmentStatus): ShipmentStatusAction[] {
  return SHIPMENT_NEXT_STATUSES[status].flatMap((s) => {
    const action = TARGET_ACTION[s];
    return action ? [action] : [];
  });
}

const ACTION_LABEL: Record<ShipmentStatusAction, string> = {
  deliver: "Entregar",
  cancel: "Cancelar",
  reprogram: "Reprogramar",
};

const ACTION_ICON: Record<ShipmentStatusAction, typeof CheckCircle2> = {
  deliver: CheckCircle2,
  cancel: XCircle,
  reprogram: CalendarClock,
};

type DialogState =
  { mode: "create" } | { mode: "edit"; shipment: Shipment } | null;

type StatusState = {
  shipment: Shipment;
  action: ShipmentStatusAction;
} | null;

/** `initialSearch`: the ?q= of a link (a scanned remito's carga). */
export function ShipmentsTable({
  actorAccess,
  initialSearch = "",
}: {
  actorAccess: Access;
  initialSearch?: string;
}) {
  const canWrite = userCan(actorAccess, "shipments:write");
  const { data: items } = useShipments();
  const [search, setSearch] = useState(initialSearch);
  const visible = useMemo(
    () => items.filter((s) => matchesShipmentSearch(s, search)),
    [items, search],
  );
  const deleteMut = useDeleteShipment();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [statusDialog, setStatusDialog] = useState<StatusState>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

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
          <div className="flex flex-col">
            <span className="font-medium">
              {row.original.client?.legal_name ?? "—"}
            </span>
            {row.original.description && (
              <span className="text-xs text-muted-foreground">
                {row.original.description}
              </span>
            )}
          </div>
        ),
        meta: { mobile: "primary" },
      },
      {
        accessorKey: "scheduled_date",
        header: "Fecha programada",
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDate(row.original.scheduled_date)}
          </span>
        ),
        meta: { headerClassName: "w-36", mobile: "secondary" },
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
        meta: { headerClassName: "w-32", mobile: "secondary" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <ShipmentStatusBadge status={row.original.status} />
            {row.original.invoice_id && !row.original.invoice_void && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5" />
                Facturada
              </span>
            )}
          </div>
        ),
        meta: { headerClassName: "w-36", mobile: "primary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => {
          const shipment = row.original;
          const actions = canWrite ? statusActions(shipment.status) : [];
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canWrite && (
                  <DropdownMenuItem
                    onClick={() => setDialog({ mode: "edit", shipment })}
                  >
                    <Pencil className="size-4" />
                    Editar
                  </DropdownMenuItem>
                )}
                {actions.length > 0 && <DropdownMenuSeparator />}
                {actions.map((action) => {
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
                {canWrite && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => setHistoryId(shipment.id)}>
                  <History className="size-4" />
                  Historial
                </DropdownMenuItem>
                {canWrite && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDelete(shipment)}
                  >
                    <Trash2 className="size-4" />
                    Borrar
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [canWrite, confirm, deleteMut]);

  return (
    <>
      <PageHeader
        title="Cargas"
        description="Cargas a transportar con cliente, fecha, viaje y estado de entrega."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({ mode: "create" })}>
              <Plus />
              Nueva carga
            </Button>
          )
        }
      />

      <ListSearch
        value={search}
        onChange={setSearch}
        placeholder="Buscar por cliente, descripción o dirección…"
      />

      <DataTable
        columns={columns}
        data={visible}
        getRowId={(s) => s.id}
        emptyMessage={
          search.trim() === ""
            ? "Sin cargas. Creá la primera."
            : "Ninguna carga coincide con la búsqueda."
        }
      />

      {canWrite && dialog && (
        <ShipmentDialog
          mode={dialog.mode}
          shipment={dialog.mode === "edit" ? dialog.shipment : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {canWrite && (
        <ShipmentStatusDialog
          shipment={statusDialog?.shipment ?? null}
          action={statusDialog?.action ?? null}
          onClose={() => setStatusDialog(null)}
        />
      )}

      <ShipmentHistoryDialog
        shipmentId={historyId}
        onClose={() => setHistoryId(null)}
      />
    </>
  );
}
