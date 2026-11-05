"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInteger, formatPeriod, todayInAR } from "@/lib/format";

import { useSaveKmReading } from "../hooks/use-vehicle-km";
import type { VehicleKmRow } from "../schema";

const FormSchema = z.object({
  km: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d)?$/, "Ingresá los km (hasta un decimal)."),
  read_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  notes: z.string().trim().max(500, "Máx 500 caracteres."),
});

type FormValues = z.infer<typeof FormSchema>;

function toKm(value: string): number {
  return Number(value.replace(",", "."));
}

function defaults(row: VehicleKmRow | null): FormValues {
  return {
    km: row?.reading ? String(row.reading.km) : "",
    read_on: row?.reading?.read_on ?? todayInAR(),
    notes: row?.reading?.notes ?? "",
  };
}

export function KmReadingDialog({
  period,
  row,
  onOpenChange,
}: {
  period: string;
  row: VehicleKmRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveKmReading();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: defaults(row),
  });

  useEffect(() => {
    form.reset(defaults(row));
  }, [row, form]);

  const kmText = useWatch({ control: form.control, name: "km" });
  const km = FormSchema.shape.km.safeParse(kmText).success
    ? toKm(kmText)
    : null;
  const previous = row?.previous ?? null;
  const decreased = km !== null && previous !== null && km < previous.km;

  function onSubmit(values: FormValues) {
    if (!row) return;
    save.mutate(
      {
        vehicle_id: row.vehicle_id,
        period,
        km: toKm(values.km),
        read_on: values.read_on,
        notes: values.notes,
      },
      {
        onSuccess: () => {
          toast.success(`Km de ${row.patente} guardado.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Km de {row?.patente} · {formatPeriod(period)}
          </DialogTitle>
          <DialogDescription>
            {previous
              ? `Lectura anterior: ${formatInteger(previous.km)} km (${formatPeriod(previous.period)}).`
              : "Es la primera lectura de este vehículo."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="km"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Km del odómetro</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" autoFocus />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="read_on"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de lectura</FormLabel>
                    <FormControl>
                      <DatePicker {...field} max={todayInAR()} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {decreased && previous && (
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Es menos que la lectura de {formatPeriod(previous.period)} (
                  {formatInteger(previous.km)} km). Revisalo; si se cambió el
                  odómetro, anotalo en las notas.
                </span>
              </p>
            )}
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
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
