"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
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

import { useSeedPayrollPeriod } from "../hooks/use-payroll";
import { MONTH_LABELS } from "../payroll-schema";

const FormSchema = z.object({
  year: z.string().regex(/^\d{4}$/, "Año inválido."),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "Mes inválido."),
});

type FormValues = z.infer<typeof FormSchema>;

export function NewPayrollPeriodDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const mut = useSeedPayrollPeriod();

  const today = new Date();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      year: String(today.getFullYear()),
      month: String(today.getMonth() + 1),
    },
  });

  function onSubmit(values: FormValues) {
    const year = Number(values.year);
    const month = Number(values.month);
    mut.mutate(
      { year, month },
      {
        onSuccess: () => {
          toast.success(`Período ${MONTH_LABELS[month - 1]} ${year} generado.`);
          setOpen(false);
          router.push(`/hr/payroll/${year}/${month}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const years = Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo período
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar período</DialogTitle>
          <DialogDescription>
            Crea (si no existe) el período + entries draft para todos los
            empleados activos con sus defaults.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mes</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONTH_LABELS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
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
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Año</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mut.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Generando…" : "Generar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
