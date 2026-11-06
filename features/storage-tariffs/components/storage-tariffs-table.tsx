"use client";

import { MoreHorizontal, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { userCan, type Access } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";

import {
  useDeleteStorageTariff,
  useSetStorageTariffActive,
  useStorageTariffs,
} from "../hooks/use-storage-tariffs";
import {
  TARIFF_PERIOD_LABELS,
  tariffVigencia,
  type StorageTariff,
} from "../schema";

import { IncreaseTariffsDialog } from "./increase-tariffs-dialog";
import { StorageTariffDialog } from "./storage-tariff-dialog";

const VIGENCIA_LABEL = {
  vigente: "Vigente",
  vencida: "Vencida",
  futura: "Futura",
} as const;

function rate(amount: number): string {
  return `$${amount.toLocaleString("es-AR")}`;
}

export function StorageTariffsTable({
  actorAccess,
  clientOptions,
}: {
  actorAccess: Access;
  /** null: the clients could not be read. */
  clientOptions: { id: string; legal_name: string }[] | null;
}) {
  // The permission every tariff write action checks («Activo» and
  // «Aumentar %» included), as on the client page's tarifario.
  const canWrite = userCan(actorAccess, "storage_billing:issue");
  const { data: items } = useStorageTariffs();
  const deleteMut = useDeleteStorageTariff();
  const toggleMut = useSetStorageTariffActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; tariff: StorageTariff } | null
  >(null);
  const [increaseOpen, setIncreaseOpen] = useState(false);

  const columns = useMemo<ColumnDef<StorageTariff>[]>(() => {
    async function handleDelete(t: StorageTariff) {
      const ok = await confirm({
        title: `Borrar tarifa ${t.client?.legal_name ?? "General"}`,
        description: "Se elimina la tarifa. No se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(t.id, {
        onSuccess: () => toast.success("Tarifa borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    function handleToggle(t: StorageTariff) {
      toggleMut.mutate(
        { id: t.id, is_active: !t.is_active },
        { onError: (err) => toast.error(err.message) },
      );
    }

    return [
      {
        accessorKey: "client",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.client?.legal_name ?? "General"}
            {row.original.area_label && (
              <span className="block text-xs font-normal text-muted-foreground">
                {row.original.area_label}
              </span>
            )}
            {row.original.migrated_to_client_tariffs_at && (
              <span className="block text-xs font-normal text-muted-foreground">
                En el tarifario del cliente (se edita ahí)
              </span>
            )}
          </span>
        ),
      },
      {
        id: "rate",
        header: "Tarifa",
        enableSorting: false,
        meta: { headerClassName: "w-48", cellClassName: "tabular-nums" },
        cell: ({ row }) =>
          `${rate(row.original.rate_per_pallet)}/pallet ${TARIFF_PERIOD_LABELS[row.original.period]}`,
      },
      {
        id: "handling_in",
        header: "Carga",
        enableSorting: false,
        meta: {
          headerClassName: "w-24 text-right",
          cellClassName: "text-right tabular-nums",
        },
        cell: ({ row }) => rate(row.original.handling_in),
      },
      {
        id: "handling_out",
        header: "Descarga",
        enableSorting: false,
        meta: {
          headerClassName: "w-24 text-right",
          cellClassName: "text-right tabular-nums",
        },
        cell: ({ row }) => rate(row.original.handling_out),
      },
      {
        id: "validity",
        header: "Vigencia",
        enableSorting: false,
        meta: { headerClassName: "w-56", cellClassName: "tabular-nums" },
        cell: ({ row }) =>
          `${row.original.valid_from} → ${row.original.valid_to ?? "—"}`,
      },
      {
        id: "vigencia_state",
        header: "Estado",
        enableSorting: false,
        meta: { headerClassName: "w-24" },
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
      {
        accessorKey: "is_active",
        header: "Activo",
        meta: { headerClassName: "w-20" },
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            disabled={!canWrite}
            onCheckedChange={() => handleToggle(row.original)}
            aria-label="Activo"
          />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) =>
          canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
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
                  className="text-destructive"
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
  }, [canWrite, confirm, deleteMut, toggleMut]);

  return (
    <>
      <PageHeader
        title="Tarifas de almacenaje"
        description="Tarifas por pallet con vigencia. Una tarifa sin cliente aplica como general para todos."
        actions={
          <>
            <ExportButton resource="storage-tariffs" />
            {canWrite && (
              <>
                <Button variant="outline" onClick={() => setIncreaseOpen(true)}>
                  <TrendingUp />
                  Aumentar %
                </Button>
                <Button onClick={() => setDialog({ mode: "create" })}>
                  <Plus />
                  Nueva tarifa
                </Button>
              </>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(t) => t.id}
        emptyMessage="Sin tarifas. Agregá la primera."
      />

      {canWrite && dialog && (
        <StorageTariffDialog
          mode={dialog.mode}
          tariff={dialog.mode === "edit" ? dialog.tariff : undefined}
          clientOptions={clientOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {canWrite && (
        <IncreaseTariffsDialog
          tariffs={items}
          open={increaseOpen}
          onOpenChange={setIncreaseOpen}
        />
      )}
    </>
  );
}
