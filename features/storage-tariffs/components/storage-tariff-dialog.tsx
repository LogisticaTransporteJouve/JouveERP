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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  useCreateStorageTariff,
  useUpdateStorageTariff,
} from "../hooks/use-storage-tariffs";
import {
  TARIFF_PERIODS,
  TARIFF_PERIOD_LABELS,
  type StorageTariff,
} from "../schema";

const NONE = "__none__";

const FormSchema = z.object({
  client_id: z.string(),
  rate_per_pallet: z
    .string()
    .refine((v) => Number(v) > 0, "La tarifa debe ser mayor a 0."),
  handling_in: z
    .string()
    .refine((v) => v === "" || Number(v) >= 0, "No puede ser negativo."),
  handling_out: z
    .string()
    .refine((v) => v === "" || Number(v) >= 0, "No puede ser negativo."),
  period: z.enum(TARIFF_PERIODS),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  valid_to: z.string(),
  notes: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(tariff?: StorageTariff): FormValues {
  return {
    client_id: tariff?.client_id ?? "",
    rate_per_pallet: tariff ? String(tariff.rate_per_pallet) : "",
    handling_in: tariff ? String(tariff.handling_in) : "0",
    handling_out: tariff ? String(tariff.handling_out) : "0",
    period: tariff?.period ?? "monthly",
    valid_from: tariff?.valid_from ?? "",
    valid_to: tariff?.valid_to ?? "",
    notes: tariff?.notes ?? "",
  };
}

export function StorageTariffDialog({
  mode,
  tariff,
  clientOptions,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  tariff?: StorageTariff;
  clientOptions: { id: string; legal_name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateStorageTariff();
  const updateMut = useUpdateStorageTariff();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(tariff),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(tariff));
  }, [open, tariff, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      client_id: values.client_id,
      rate_per_pallet: Number(values.rate_per_pallet),
      handling_in: values.handling_in === "" ? 0 : Number(values.handling_in),
      handling_out:
        values.handling_out === "" ? 0 : Number(values.handling_out),
      period: values.period,
      valid_from: values.valid_from,
      valid_to: values.valid_to,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Tarifa creada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (tariff) {
      updateMut.mutate(
        { id: tariff.id, ...payload },
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
            {isEdit ? "Editar tarifa" : "Nueva tarifa"}
          </DialogTitle>
          <DialogDescription>
            Tarifa de almacenaje por pallet con vigencia. Dejá el cliente en
            general para una tarifa por defecto.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="client_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente (opcional)</FormLabel>
                  <Select
                    value={field.value === "" ? NONE : field.value}
                    onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="General (todos)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>General (todos)</SelectItem>
                      {clientOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.legal_name}
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
                name="rate_per_pallet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tarifa por pallet</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="1500"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Período</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TARIFF_PERIODS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {TARIFF_PERIOD_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="handling_in"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carga (por pallet)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="0"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="handling_out"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descarga (por pallet)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="0"
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
                name="valid_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vigente desde</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="valid_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vigente hasta (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
