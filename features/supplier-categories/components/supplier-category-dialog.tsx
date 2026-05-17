"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

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
import {
  slugFromName,
  type SupplierCategory,
} from "../schema";

type Mode = "create" | "edit";

const FormSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(60),
  slug: z.string().trim().max(40),
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
      slug: category?.slug ?? "",
      is_active: category?.is_active ?? true,
    },
  });

  // Reset cuando se cambia entre crear/editar.
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: category?.name ?? "",
      slug: category?.slug ?? "",
      is_active: category?.is_active ?? true,
    });
  }, [open, category, form]);

  const watchedName = form.watch("name");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Auto-slug desde nombre en modo create, hasta que el user lo toque.
  useEffect(() => {
    if (mode !== "create") return;
    if (slugManuallyEdited) return;
    if (watchedName.length === 0) return;
    form.setValue("slug", slugFromName(watchedName), { shouldDirty: false });
  }, [watchedName, mode, slugManuallyEdited, form]);

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(
        { name: values.name, slug: values.slug || undefined, is_active: values.is_active },
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
          slug: values.slug,
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
              : "Cambiá el nombre, slug o estado de la categoría."}
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
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="combustible"
                      autoComplete="off"
                      onChange={(e) => {
                        field.onChange(e.target.value);
                        setSlugManuallyEdited(true);
                      }}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Identificador interno. Solo minúsculas, números y _. Se
                    autogenera desde el nombre si lo dejás vacío.
                  </FormDescription>
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
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
