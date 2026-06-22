"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useDeleteStorageTariff,
  useSetStorageTariffActive,
  useStorageTariffs,
} from "../hooks/use-storage-tariffs";
import { TARIFF_PERIOD_LABELS, type StorageTariff } from "../schema";

import { StorageTariffDialog } from "./storage-tariff-dialog";

function rate(amount: number): string {
  return `$${amount.toLocaleString("es-AR")}`;
}

export function StorageTariffsTable({
  clientOptions,
}: {
  clientOptions: { id: string; legal_name: string }[];
}) {
  const { data: items } = useStorageTariffs();
  const deleteMut = useDeleteStorageTariff();
  const toggleMut = useSetStorageTariffActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; tariff: StorageTariff } | null
  >(null);

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

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tarifas de almacenaje
          </h1>
          <p className="text-muted-foreground text-sm">
            Tarifas por pallet con vigencia. Una tarifa sin cliente aplica como
            general para todos.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nueva tarifa
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-48">Tarifa</TableHead>
              <TableHead className="w-56">Vigencia</TableHead>
              <TableHead className="w-20">Activo</TableHead>
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
                  Sin tarifas. Agregá la primera.
                </TableCell>
              </TableRow>
            ) : (
              items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.client?.legal_name ?? "General"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {`${rate(t.rate_per_pallet)}/pallet ${TARIFF_PERIOD_LABELS[t.period]}`}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {`${t.valid_from} → ${t.valid_to ?? "—"}`}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={t.is_active}
                      onCheckedChange={() => handleToggle(t)}
                      aria-label="Activo"
                    />
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
                          onClick={() => setDialog({ mode: "edit", tariff: t })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(t)}
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
    </>
  );
}
