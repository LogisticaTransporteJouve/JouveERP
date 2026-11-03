"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
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
  useCreateClientTariff,
  useUpdateClientTariff,
} from "../hooks/use-client-tariffs";
import {
  CLIENT_TARIFF_CONCEPTS,
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_CURRENCIES,
  CLIENT_TARIFF_UNITS,
  CLIENT_TARIFF_UNIT_LABELS,
  UNITS_BY_CONCEPT,
  type ClientTariff,
} from "../schema";

// Plain strings on screen; the action schema coerces and checks the rest
// (unit per concept, vigencia order). Overlaps are refused by the DB guard.
const FormSchema = z.object({
  concept: z.enum(CLIENT_TARIFF_CONCEPTS),
  unit: z.enum(CLIENT_TARIFF_UNITS),
  price: z
    .string()
    .refine(
      (v) => v.trim() !== "" && Number(v) >= 0,
      "Ingresá un precio (0 o más).",
    ),
  currency: z.enum(CLIENT_TARIFF_CURRENCIES),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  valid_to: z.string(),
  notes: z.string().trim().max(500),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(tariff?: ClientTariff): FormValues {
  return {
    concept: tariff?.concept ?? "storage",
    unit: tariff?.unit ?? "pallet_month",
    price: tariff ? String(tariff.price) : "",
    currency: tariff?.currency ?? "ARS",
    valid_from: tariff?.valid_from ?? "",
    valid_to: tariff?.valid_to ?? "",
    notes: tariff?.notes ?? "",
  };
}

export function ClientTariffDialog({
  clientId,
  tariff,
  open,
  onOpenChange,
}: {
  clientId: string;
  /** The tariff to edit; none creates one. */
  tariff?: ClientTariff;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateClientTariff();
  const updateMut = useUpdateClientTariff();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = tariff !== undefined;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(tariff),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(tariff));
  }, [open, tariff, form]);

  const concept = useWatch({ control: form.control, name: "concept" });
  const units = UNITS_BY_CONCEPT[concept];

  function onSubmit(values: FormValues) {
    const payload = {
      concept: values.concept,
      unit: values.unit,
      price: values.price,
      currency: values.currency,
      valid_from: values.valid_from,
      valid_to: values.valid_to,
      notes: values.notes,
    };
    const onError = (err: Error) => toast.error(err.message);
    if (tariff) {
      updateMut.mutate(
        { id: tariff.id, ...payload },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      createMut.mutate(
        { client_id: clientId, ...payload },
        {
          onSuccess: () => {
            toast.success("Tarifa creada.");
            onOpenChange(false);
          },
          onError,
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle>
          <DialogDescription>
            Precio del cliente para un concepto. Las vigencias de un mismo
            concepto no se pueden superponer: para cambiar el precio, cerrá la
            tarifa anterior el día antes.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="concept"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Concepto</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        const next = CLIENT_TARIFF_CONCEPTS.find(
                          (c) => c === v,
                        );
                        const nextUnits = next ? UNITS_BY_CONCEPT[next] : [];
                        // Keep the unit valid for the new concept.
                        if (!nextUnits.includes(form.getValues("unit"))) {
                          form.setValue("unit", nextUnits[0] ?? "pallet", {
                            shouldDirty: true,
                          });
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CLIENT_TARIFF_CONCEPTS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CLIENT_TARIFF_CONCEPT_LABELS[c]}
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
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={units.length === 1}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {units.map((u) => (
                          <SelectItem key={u} value={u}>
                            {CLIENT_TARIFF_UNIT_LABELS[u]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CLIENT_TARIFF_CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <FormLabel>Hasta (opcional)</FormLabel>
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
                    <Textarea {...field} rows={2} maxLength={500} />
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
