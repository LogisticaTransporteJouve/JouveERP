"use client";

import { Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

import {
  useDeleteDriver,
  useDrivers,
  useSetDriverActive,
} from "../hooks/use-drivers";
import type { Driver } from "../schema";

import { DriverDialog } from "./driver-dialog";
import { DriverLinkDialog, type LinkableUser } from "./driver-link-dialog";

export function DriversTable({
  linkableUsers,
}: {
  linkableUsers?: LinkableUser[];
}) {
  const { data: items } = useDrivers();
  const deleteMut = useDeleteDriver();
  const toggleMut = useSetDriverActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; driver: Driver } | null
  >(null);
  const [linkDriver, setLinkDriver] = useState<Driver | null>(null);
  const canLink = linkableUsers !== undefined;

  const columns = useMemo<ColumnDef<Driver>[]>(() => {
    async function handleDelete(d: Driver) {
      const ok = await confirm({
        title: `Borrar ${d.full_name}`,
        description: "Si tiene viajes, quedan sin chofer asignado.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(d.id, {
        onSuccess: () => toast.success("Chofer borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "full_name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.full_name}</span>
        ),
      },
      {
        accessorKey: "cuit",
        header: "CUIT",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.cuit ?? "—"}</span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "license_number",
        header: "Licencia",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.license_number ?? "—"}
            {row.original.license_category
              ? ` (${row.original.license_category})`
              : ""}
          </span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "phone",
        header: "Teléfono",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.phone ?? "—"}</span>
        ),
        meta: { headerClassName: "w-36" },
      },
      {
        accessorKey: "is_active",
        header: "Activo",
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            onCheckedChange={(v) =>
              toggleMut.mutate(
                { id: row.original.id, is_active: v },
                { onError: (err) => toast.error(err.message) },
              )
            }
            aria-label="Activo"
          />
        ),
        meta: { headerClassName: "w-20" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  setDialog({ mode: "edit", driver: row.original })
                }
              >
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              {canLink && (
                <DropdownMenuItem onClick={() => setLinkDriver(row.original)}>
                  <Link2 className="size-4" />
                  {row.original.user_id
                    ? "Cambiar usuario"
                    : "Vincular usuario"}
                </DropdownMenuItem>
              )}
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
  }, [confirm, deleteMut, toggleMut, canLink]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choferes</h1>
          <p className="text-muted-foreground text-sm">
            Choferes propios y contratados de la flota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="drivers" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo chofer
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(d) => d.id}
        emptyMessage="Sin choferes. Agregá el primero."
      />

      {dialog && (
        <DriverDialog
          mode={dialog.mode}
          driver={dialog.mode === "edit" ? dialog.driver : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {linkDriver && linkableUsers && (
        <DriverLinkDialog
          driver={linkDriver}
          users={linkableUsers}
          open={linkDriver !== null}
          onOpenChange={(o) => {
            if (!o) setLinkDriver(null);
          }}
        />
      )}
    </>
  );
}
