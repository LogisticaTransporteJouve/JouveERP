"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ChannelsReadError } from "@/components/channels-read-error";
import { MoneyInput } from "@/components/money-input";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseArAmount } from "@/lib/format";
import { positiveArAmountField } from "@/lib/validation/common";

import { useCreateLoan } from "../hooks/use-loans";
import { LOAN_KINDS, LOAN_KIND_LABEL } from "../schema";

const FormSchema = z.object({
  kind: z.enum(LOAN_KINDS),
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
  lender: z.string().trim().max(200),
  principal: positiveArAmountField,
  currency: z.enum(["ARS", "USD"]),
  channel_id: z.string().min(1, "Canal requerido."),
  installments_count: z
    .string()
    .regex(/^\d+$/, "Cantidad inválida.")
    .refine((v) => Number(v) >= 1 && Number(v) <= 600, "Entre 1 y 600."),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

const DEFAULTS: FormValues = {
  kind: "prestamo",
  description: "",
  lender: "",
  principal: "",
  currency: "ARS",
  channel_id: "",
  installments_count: "",
  first_due_date: "",
  notes: "",
};

export function LoanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { channels } = useScope();
  const channelOptions = channels.filter((c) => c.is_active);
  const createMut = useCreateLoan();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open, form]);

  function onSubmit(values: FormValues) {
    createMut.mutate(
      { ...values, principal: parseArAmount(values.principal) ?? 0 },
      {
        onSuccess: () => {
          toast.success("Préstamo creado.");
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
          <DialogTitle>Nuevo préstamo / leasing</DialogTitle>
          <DialogDescription>
            Cargá el capital y la cantidad de cuotas. Se genera el cronograma de
            cuotas iguales (después editás cada una si hace falta).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LOAN_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {LOAN_KIND_LABEL[k]}
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
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Préstamo Banco Nación" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Acreedor (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Banco / dador" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal (blanco / interno)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un canal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {channelOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.is_fiscal ? " (fiscal)" : " (interna)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ChannelsReadError inline />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="principal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capital</FormLabel>
                    <FormControl>
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="installments_count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuotas</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        min={1}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="first_due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>1ª cuota</FormLabel>
                    <FormControl>
                      <DatePicker {...field} />
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
              <Button type="submit" disabled={createMut.isPending}>
                Crear
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
