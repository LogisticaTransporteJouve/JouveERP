"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { DisabledHint, NO_CHANGES_REASON } from "@/components/disabled-hint";
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

import {
  useCreateSupplierCategory,
  useUpdateSupplierCategory,
} from "../hooks/use-supplier-categories";
import { SupplierCategoryNameSchema, type SupplierCategory } from "../schema";

type Mode = "create" | "edit";

const FormSchema = z.object({
  name: SupplierCategoryNameSchema,
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export function SupplierCategoryDialog({
  mode,
  category,
  open,
  onOpenChange,
}: {
  mode: Mode;
  category?: SupplierCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateSupplierCategory();
  const updateMut = useUpdateSupplierCategory();
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: category?.name ?? "",
      is_active: category?.is_active ?? true,
    },
  });

  // Reset when switching between create/edit.
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: category?.name ?? "",
      is_active: category?.is_active ?? true,
    });
  }, [open, category, form]);

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(
        {
          name: values.name,
          is_active: values.is_active,
        },
        {
          onSuccess: () => {
            toast.success("Categoría creada.");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else if (category) {
      updateMut.mutate(
        {
          id: category.id,
          name: values.name,
          is_active: values.is_active,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Nueva categoría" : "Editar categoría"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Agregá una categoría para clasificar proveedores y gastos."
              : "Cambiá el nombre o el estado de la categoría."}
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
                    <Input
                      {...field}
                      placeholder="Ej: Combustible"
                      autoComplete="off"
                    />
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
                  <div className="space-y-0.5">
                    <FormLabel className="cursor-pointer">Activa</FormLabel>
                    <FormDescription className="text-xs">
                      Las categorías inactivas no aparecen en los pickers de
                      proveedores nuevos.
                    </FormDescription>
                  </div>
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
              <DisabledHint
                reason={
                  mode === "edit" && !form.formState.isDirty
                    ? NO_CHANGES_REASON
                    : null
                }
              >
                <Button
                  type="submit"
                  disabled={
                    isSaving || (mode === "edit" && !form.formState.isDirty)
                  }
                >
                  {isSaving
                    ? "Guardando…"
                    : mode === "create"
                      ? "Crear"
                      : "Guardar cambios"}
                </Button>
              </DisabledHint>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
