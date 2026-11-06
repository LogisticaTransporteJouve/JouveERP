"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fiscalYearMonthsLabel, monthName } from "@/lib/fiscal-year";

import { useUpdateAccountingSettings } from "../hooks/use-accounting-settings";

const FormSchema = z.object({ month: z.string().min(1, "Elegí un mes.") });
type FormValues = z.infer<typeof FormSchema>;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function FiscalYearDialog({
  startMonth,
  open,
  onOpenChange,
}: {
  startMonth: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useUpdateAccountingSettings();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { month: String(startMonth) },
  });

  useEffect(() => {
    if (open) form.reset({ month: String(startMonth) });
  }, [open, startMonth, form]);

  const chosen = Number(useWatch({ control: form.control, name: "month" }));
  const isDirty = form.formState.isDirty;

  function onSubmit(values: FormValues) {
    mutation.mutate(
      { fiscalYearStartMonth: Number(values.month) },
      {
        onSuccess: () => {
          toast.success("Inicio del ejercicio guardado.");
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
          <DialogTitle>Inicio del ejercicio</DialogTitle>
          <DialogDescription>
            El mes en que empieza el año fiscal de la empresa. Lo usan el Estado
            de Resultados sin «Desde», el Balance General y el Resultado de
            gestión.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="month"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mes de inicio</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper" className="max-h-72">
                      {MONTHS.map((month) => (
                        <SelectItem key={month} value={String(month)}>
                          {monthName(month)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    El ejercicio va de {fiscalYearMonthsLabel(chosen)}.
                    Cambiarlo no toca ningún asiento: solo cambia qué meses
                    suman los reportes del ejercicio.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancelar
              </Button>
              <DisabledHint reason={!isDirty ? NO_CHANGES_REASON : null}>
                <Button type="submit" disabled={mutation.isPending || !isDirty}>
                  {mutation.isPending ? "Guardando…" : "Guardar"}
                </Button>
              </DisabledHint>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
