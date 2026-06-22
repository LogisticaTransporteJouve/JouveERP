"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  if (days <= 30) return "text-amber-600 dark:text-amber-500";
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
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo documento
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dueño</TableHead>
              <TableHead className="w-40">Tipo</TableHead>
              <TableHead className="w-32">N°</TableHead>
              <TableHead className="w-32">Vence</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin documentación. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {d.driver ? "Chofer" : "Vehículo"}
                      </Badge>
                      <span className="font-medium">
                        {d.vehicle?.patente ?? d.driver?.full_name ?? "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {FLEET_DOC_KIND_LABELS[d.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {d.number ?? "—"}
                  </TableCell>
                  <TableCell
                    className={cn("text-sm", expiryClass(d.expires_at))}
                  >
                    {d.expires_at}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDialog({ mode: "edit", doc: d })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(d)}
                        >
                          <Trash2 className="size-4" />
                          Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
