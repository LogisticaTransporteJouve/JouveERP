"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
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

import { useDeletePallet, usePallets } from "../hooks/use-pallets";
import { PALLET_STATUS_LABELS, type Pallet } from "../schema";

import { PalletDialog } from "./pallet-dialog";

export function PalletsTable({
  warehouseOptions,
  clientOptions,
  productOptions,
}: {
  warehouseOptions: { id: string; name: string }[];
  clientOptions: { id: string; legal_name: string }[];
  productOptions: { id: string; name: string }[];
}) {
  const { data: items } = usePallets();
  const deleteMut = useDeletePallet();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; pallet: Pallet } | null
  >(null);

  async function handleDelete(p: Pallet) {
    const ok = await confirm({
      title: `Borrar pallet ${p.code}`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(p.id, {
      onSuccess: () => toast.success("Pallet borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pallets</h1>
          <p className="text-muted-foreground text-sm">
            Unidades físicas almacenadas por depósito y cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="pallets" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo pallet
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Código</TableHead>
              <TableHead>Depósito</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="w-24">Cant.</TableHead>
              <TableHead className="w-32">Estado</TableHead>
              <TableHead className="w-32">Ingreso</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin pallets. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="text-sm">
                    {p.warehouse?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.client?.legal_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.product?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.quantity ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {PALLET_STATUS_LABELS[p.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{p.entry_date}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDialog({ mode: "edit", pallet: p })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(p)}
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
        <PalletDialog
          mode={dialog.mode}
          pallet={dialog.mode === "edit" ? dialog.pallet : undefined}
          warehouseOptions={warehouseOptions}
          clientOptions={clientOptions}
          productOptions={productOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
