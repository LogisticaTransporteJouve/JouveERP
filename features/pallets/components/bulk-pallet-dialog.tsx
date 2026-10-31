"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useCreatePalletsBulk } from "../hooks/use-pallets";

const NONE = "__none__";

const FormSchema = z.object({
  warehouse_id: z.string().uuid("Depósito requerido."),
  client_id: z.string().uuid("Cliente requerido."),
  product_id: z.string(),
  quantity: z.string(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  notes: z.string().trim().max(2000),
  count: z
    .string()
    .regex(/^\d+$/, "Ingresá una cantidad.")
    .refine((v) => Number(v) >= 1 && Number(v) <= 500, "Entre 1 y 500."),
  code_prefix: z
    .string()
    .trim()
    .min(1, "Prefijo requerido.")
    .max(40, "Prefijo demasiado largo.")
    .regex(/^[A-Za-z0-9-]+$/, "Solo letras, números o guion."),
});

type FormValues = z.infer<typeof FormSchema>;

const DEFAULTS: FormValues = {
  warehouse_id: "",
  client_id: "",
  product_id: "",
  quantity: "",
  entry_date: "",
  notes: "",
  count: "",
  code_prefix: "PAL",
};

export function BulkPalletDialog({
  warehouseOptions,
  clientOptions,
  productOptions,
  open,
  onOpenChange,
}: {
  warehouseOptions: { id: string; name: string }[];
  clientOptions: { id: string; legal_name: string }[];
  productOptions: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreatePalletsBulk();
  const isSaving = createMut.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open, form]);

  const count = useWatch({ control: form.control, name: "count" });
  const prefix = useWatch({ control: form.control, name: "code_prefix" });
  const previewCount = /^\d+$/.test(count) ? Number(count) : 0;

  function onSubmit(values: FormValues) {
    createMut.mutate(
      {
        warehouse_id: values.warehouse_id,
        client_id: values.client_id,
        product_id: values.product_id,
        quantity: values.quantity,
        entry_date: values.entry_date,
        notes: values.notes,
        count: values.count,
        code_prefix: values.code_prefix,
      },
      {
        onSuccess: (data) => {
          toast.success(`${data.created} pallets creados.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cargar varios pallets</DialogTitle>
          <DialogDescription>
            Datos compartidos una vez + la cantidad. Los códigos se generan
            automáticamente.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="warehouse_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Depósito</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un depósito" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {warehouseOptions.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="client_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <FormControl>
                    <Combobox
                      options={clientOptions.map((c) => ({
                        value: c.id,
                        label: c.legal_name,
                      }))}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Elegí un cliente"
                      searchPlaceholder="Buscar cliente…"
                      emptyText="Sin clientes."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="product_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Producto (opcional)</FormLabel>
                  <Select
                    value={field.value === "" ? NONE : field.value}
                    onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Ninguno" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Ninguno</SelectItem>
                      {productOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="entry_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de ingreso</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad por pallet</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad de pallets</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={500}
                        placeholder="10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code_prefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prefijo de código</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="PAL" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {previewCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Se generarán {previewCount} código
                {previewCount === 1 ? "" : "s"} automáticos (ej.{" "}
                {prefix || "PAL"}-0001, {prefix || "PAL"}-0002 …) continuando la
                secuencia.
              </p>
            )}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
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
              <Button type="submit" disabled={isSaving}>
                Crear
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
