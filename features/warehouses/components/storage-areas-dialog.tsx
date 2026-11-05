"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
  useCreateStorageArea,
  useDeleteStorageArea,
  useStorageAreas,
  useUpdateStorageArea,
} from "../hooks/use-storage-areas";
import type { Warehouse } from "../schema";

/** The areas of one warehouse: add, turn on/off, delete an unused one. */
export function StorageAreasDialog({
  warehouse,
  open,
  onOpenChange,
}: {
  warehouse: Warehouse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: allAreas } = useStorageAreas();
  const areas = allAreas.filter((a) => a.warehouse_id === warehouse.id);
  const createMut = useCreateStorageArea();
  const updateMut = useUpdateStorageArea();
  const deleteMut = useDeleteStorageArea();
  const confirm = useConfirm();
  const [name, setName] = useState("");

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMut.mutate(
      { warehouse_id: warehouse.id, name: trimmed },
      {
        onSuccess: () => {
          toast.success("Área creada.");
          setName("");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  async function remove(id: string, areaName: string) {
    const ok = await confirm({
      title: `Borrar ${areaName}`,
      description:
        "Solo se borra un área sin pallets ni tarifas. Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(id, {
      onSuccess: () => toast.success("Área borrada."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Áreas de {warehouse.name}</DialogTitle>
          <DialogDescription>
            Zonas del depósito (cámara de frío, a granel, rack). El tarifario
            del cliente puede tener un precio por área.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del área"
            maxLength={120}
            aria-label="Nombre del área"
          />
          <Button
            type="submit"
            disabled={createMut.isPending || name.trim() === ""}
          >
            <Plus />
            Agregar
          </Button>
        </form>

        {areas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin áreas. Los pallets quedan en el depósito sin área.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {areas.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span
                  className={
                    a.is_active
                      ? "min-w-0 truncate text-sm"
                      : "text-muted-foreground min-w-0 truncate text-sm line-through"
                  }
                >
                  {a.name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={a.is_active}
                    disabled={updateMut.isPending}
                    onCheckedChange={(v) =>
                      updateMut.mutate(
                        { id: a.id, is_active: v },
                        { onError: (err) => toast.error(err.message) },
                      )
                    }
                    aria-label={`${a.name} activa`}
                  />
                  <IconButton
                    label={`Borrar ${a.name}`}
                    variant="ghost"
                    disabled={deleteMut.isPending}
                    onClick={() => remove(a.id, a.name)}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
