"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useScope } from "@/components/providers/scope-provider";
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
  useCreateRecurringPayment,
  useUpdateRecurringPayment,
} from "../hooks/use-recurring-payments";
import {
  RECURRING_CATEGORIES,
  RECURRING_CATEGORY_LABELS,
  RECURRING_CURRENCIES,
  RECURRING_FREQUENCIES,
  RECURRING_FREQUENCY_LABELS,
  type RecurringPayment,
} from "../schema";

const NONE = "__none__";

const FormSchema = z.object({
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
  category: z.enum(RECURRING_CATEGORIES),
  amount: z
    .string()
    .refine((v) => Number(v) > 0, "El monto debe ser mayor a 0."),
  currency: z.enum(RECURRING_CURRENCIES),
  frequency: z.enum(RECURRING_FREQUENCIES),
  next_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  end_date: z.string(),
  channel_id: z.string(),
  notes: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(payment?: RecurringPayment): FormValues {
  return {
    description: payment?.description ?? "",
    category: payment?.category ?? "alquiler",
    amount: payment ? String(payment.amount) : "",
    currency: payment?.currency ?? "ARS",
    frequency: payment?.frequency ?? "monthly",
    next_due_date: payment?.next_due_date ?? "",
    end_date: payment?.end_date ?? "",
    channel_id: payment?.channel_id ?? "",
    notes: payment?.notes ?? "",
  };
}

export function RecurringPaymentDialog({
  mode,
  payment,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  payment?: RecurringPayment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const createMut = useCreateRecurringPayment();
  const updateMut = useUpdateRecurringPayment();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(payment),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(payment));
  }, [open, payment, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      description: values.description,
      category: values.category,
      amount: Number(values.amount),
      currency: values.currency,
      frequency: values.frequency,
      next_due_date: values.next_due_date,
      end_date: values.end_date,
      channel_id: values.channel_id,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Pago recurrente creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (payment) {
      updateMut.mutate(
        { id: payment.id, ...payload },
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
            {isEdit ? "Editar pago recurrente" : "Nuevo pago recurrente"}
          </DialogTitle>
          <DialogDescription>
            Compromiso de egreso que se repite (alquiler, servicios, préstamos,
            impuestos, sueldos). Alimenta el cash-flow proyectado.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Alquiler depósito" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RECURRING_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {RECURRING_CATEGORY_LABELS[c]}
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
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frecuencia</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RECURRING_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {RECURRING_FREQUENCY_LABELS[f]}
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="150000"
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
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RECURRING_CURRENCIES.map((c) => (
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
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="next_due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Próximo vencimiento</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fin (opcional)</FormLabel>
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
              name="channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal (opcional)</FormLabel>
                  <Select
                    value={field.value === "" ? NONE : field.value}
                    onValueChange={(v) =>
                      field.onChange(v === NONE ? "" : v)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Ninguno" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Ninguno</SelectItem>
                      {activeChannels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
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
