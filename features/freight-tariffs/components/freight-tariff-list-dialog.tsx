"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayInAR } from "@/lib/format";

import {
  useCreateFreightTariffList,
  useUpdateFreightTariffList,
} from "../hooks/use-freight-tariffs";
import type { FreightTariffList } from "../schema";

/** Creates a tarifario (with its first period, empty) or renames one. */
export function FreightTariffListDialog({
  list,
  onClose,
  onCreated,
}: {
  /** The tarifario to edit; absent for a new one. */
  list?: FreightTariffList;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const create = useCreateFreightTariffList();
  const update = useUpdateFreightTariffList();
  const [name, setName] = useState(list?.name ?? "");
  const [notes, setNotes] = useState(list?.notes ?? "");
  const [label, setLabel] = useState("");
  const [validFrom, setValidFrom] = useState(todayInAR());
  const pending = create.isPending || update.isPending;

  function submit() {
    const done = {
      onError: (err: Error) => toast.error(err.message),
    };
    if (list) {
      update.mutate(
        { id: list.id, name, notes, client_id: list.client?.id ?? null },
        {
          ...done,
          onSuccess: () => {
            toast.success("Tarifario actualizado.");
            onClose();
          },
        },
      );
      return;
    }
    create.mutate(
      { name, notes, label, valid_from: validFrom, lines: [] },
      {
        ...done,
        onSuccess: (r) => {
          toast.success("Tarifario creado. Cargale los precios.");
          onCreated?.(r.id);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {list ? "Editar tarifario" : "Nuevo tarifario"}
          </DialogTitle>
          <DialogDescription>
            Por ejemplo «General», «Consumidor final», «Muebles» o el nombre de
            un cliente con tarifa propia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ftl-name">Nombre</Label>
            <Input
              id="ftl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {!list && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ftl-label">Período</Label>
                <Input
                  id="ftl-label"
                  value={label}
                  placeholder="Noviembre/Diciembre 26"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ftl-from">Vigente desde</Label>
                <DatePicker
                  id="ftl-from"
                  value={validFrom}
                  onChange={setValidFrom}
                />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="ftl-notes">Notas</Label>
            <Textarea
              id="ftl-notes"
              value={notes}
              placeholder="Los precios no incluyen IVA · Seguro 1%"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Guardando…" : list ? "Guardar" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
