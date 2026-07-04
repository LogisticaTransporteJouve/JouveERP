"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
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
import { cn } from "@/lib/utils";

import {
  useDeleteFleetDocument,
  useFleetDocuments,
} from "../hooks/use-fleet-documents";
import { FLEET_DOC_KIND_LABELS, type FleetDocument } from "../schema";

import { FleetDocumentDialog } from "./fleet-document-dialog";

function expiryClass(expiresAt: string): string {
  const days = Math.round((Date.parse(expiresAt) - Date.now()) / 86400000);
  if (days <= 7) return "text-destructive font-medium";
  if (days <= 30) return "text-muted-foreground dark:text-muted-foreground";
  return "text-muted-foreground";
}

export function FleetDocumentsTable({
  vehicleOptions,
  driverOptions,
}: {
  vehicleOptions: { id: string; patente: string }[];
  driverOptions: { id: string; full_name: string }[];
}) {
  const { data: items } = useFleetDocuments();
  const deleteMut = useDeleteFleetDocument();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; doc: FleetDocument } | null
  >(null);

  const columns = useMemo<ColumnDef<FleetDocument>[]>(() => {
    async function handleDelete(d: FleetDocument) {
      const ok = await confirm({
        title: `Borrar documento ${FLEET_DOC_KIND_LABELS[d.kind]}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(d.id, {
        onSuccess: () => toast.success("Documento borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        id: "owner",
        header: "Dueño",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {row.original.driver ? "Chofer" : "Vehículo"}
            </Badge>
            <span className="font-medium">
              {row.original.vehicle?.patente ??
                row.original.driver?.full_name ??
                "—"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => (
          <Badge variant="secondary">
            {FLEET_DOC_KIND_LABELS[row.original.kind]}
          </Badge>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "number",
        header: "N°",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.number ?? "—"}</span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "expires_at",
        header: "Vence",
        cell: ({ row }) => (
          <span className={cn("text-sm", expiryClass(row.original.expires_at))}>
            {row.original.expires_at}
          </span>
        ),
        meta: { headerClassName: "w-32" },
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
                  setDialog({ mode: "edit", doc: row.original })
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
  }, [confirm, deleteMut]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Documentación de flota
          </h1>
          <p className="text-muted-foreground text-sm">
            Documentación vencible de vehículos y choferes (VTV, seguro,
            licencia, ART, etc.).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="fleet-documents" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo documento
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(d) => d.id}
        emptyMessage="Sin documentación. Agregá el primero."
      />

      {dialog && (
        <FleetDocumentDialog
          mode={dialog.mode}
          doc={dialog.mode === "edit" ? dialog.doc : undefined}
          vehicleOptions={vehicleOptions}
          driverOptions={driverOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
