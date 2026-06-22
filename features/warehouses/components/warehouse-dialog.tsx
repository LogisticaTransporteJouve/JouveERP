"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { useCreateWarehouse, useUpdateWarehouse } from "../hooks/use-warehouses";
import type { Warehouse } from "../schema";

const FormSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido.").max(120),
  address: z.string().trim().max(200),
  capacity_pallets: z.string().trim().max(10),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(warehouse?: Warehouse): FormValues {
  return {
    name: warehouse?.name ?? "",
    address: warehouse?.address ?? "",
    capacity_pallets:
      warehouse?.capacity_pallets != null
        ? String(warehouse.capacity_pallets)
        : "",
    notes: warehouse?.notes ?? "",
  };
}

export function WarehouseDialog({
  mode,
  warehouse,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  warehouse?: Warehouse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateWarehouse();
  const updateMut = useUpdateWarehouse();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(warehouse),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(warehouse));
  }, [open, warehouse, form]);

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: () => {
          toast.success("Depósito creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (warehouse) {
      updateMut.mutate(
        { id: warehouse.id, ...values },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar depósito" : "Nuevo depósito"}
          </DialogTitle>
          <DialogDescription>
            Depósito físico para almacenamiento de mercadería.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Depósito Central" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Av. Siempre Viva 742" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacity_pallets"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacidad (pallets)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="120"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || (isEdit && !form.formState.isDirty)}
              >
                {isEdit ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
