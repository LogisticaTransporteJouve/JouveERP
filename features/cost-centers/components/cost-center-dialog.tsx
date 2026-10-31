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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  useCreateCostCenter,
  useUpdateCostCenter,
} from "../hooks/use-cost-centers";
import type { CostCenter } from "../schema";

type Mode = "create" | "edit";

const FormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Mínimo 2 caracteres.")
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, "Solo MAYÚSCULAS, números, _ y -."),
  name: z.string().trim().min(2, "Nombre requerido.").max(60),
  description: z.string().trim().max(200),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export function CostCenterDialog({
  mode,
  costCenter,
  open,
  onOpenChange,
}: {
  mode: Mode;
  costCenter?: CostCenter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateCostCenter();
  const updateMut = useUpdateCostCenter();
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      code: costCenter?.code ?? "",
      name: costCenter?.name ?? "",
      description: costCenter?.description ?? "",
      is_active: costCenter?.is_active ?? true,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      code: costCenter?.code ?? "",
      name: costCenter?.name ?? "",
      description: costCenter?.description ?? "",
      is_active: costCenter?.is_active ?? true,
    });
  }, [open, costCenter, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      code: values.code.toUpperCase(),
      name: values.name,
      description: values.description.trim() || null,
      is_active: values.is_active,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Centro de costo creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (costCenter) {
      updateMut.mutate(
        {
          id: costCenter.id,
          name: payload.name,
          description: payload.description,
          is_active: payload.is_active,
        },
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

  const isEdit = mode === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar centro de costo" : "Nuevo centro de costo"}
          </DialogTitle>
          <DialogDescription>
            Dimensión contable para clasificar gastos e ingresos por flota,
            proyecto u obra.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isEdit}
                      placeholder="FLOTA"
                      autoComplete="off"
                      className="font-mono uppercase"
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    MAYÚSCULAS, números, _ y -. No editable luego.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Flota de camiones" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border px-3 py-2">
                  <FormLabel className="cursor-pointer">Activo</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || (isEdit && !form.formState.isDirty)}
              >
                {isSaving ? "Guardando…" : isEdit ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
