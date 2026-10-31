"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { todayInAR } from "@/lib/format";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import { useCreateCheque } from "../hooks/use-checks";
import type { CheckChannelOption } from "./check-action-dialogs";
import {
  CHEQUE_CURRENCIES,
  CHECK_KINDS,
  CHECK_KIND_LABEL,
  type ChequeCurrency,
  type ChequeKind,
} from "../schema";

const FormSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  check_number: z.string().trim().min(1, "Número requerido.").max(60),
  bank_name: z.string().trim().min(1, "Banco requerido.").max(120),
  drawer_name: z.string().trim().min(1, "Firmante requerido.").max(120),
  drawer_cuit: z.string().trim().max(20),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Monto requerido."),
  currency: z.enum(CHEQUE_CURRENCIES),
  cartera_account_id: z.string().uuid("Cuenta de cartera requerida."),
  channel_id: z.string().min(1, "Canal requerido."),
  notes: z.string().trim().max(500),
});

type FormValues = z.infer<typeof FormSchema>;

export function NewChequeDialog({
  channels,
}: {
  channels: CheckChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const { data: accounts } = useAccountsList();
  const carteraOptions = accounts.filter(
    (a) => a.is_active && (a.type === "checks" || a.type === "echeq"),
  );
  const createMut = useCreateCheque();

  const defaultCarteraId = (kind: ChequeKind) => {
    const target = kind === "fisico" ? "checks" : "echeq";
    const match = carteraOptions.find((a) => a.type === target);
    return match?.id ?? carteraOptions[0]?.id ?? "";
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      kind: "fisico",
      check_number: "",
      bank_name: "",
      drawer_name: "",
      drawer_cuit: "",
      issue_date: todayInAR(),
      due_date: todayInAR(),
      amount: "",
      currency: "ARS",
      cartera_account_id: defaultCarteraId("fisico"),
      channel_id: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (open && !form.getValues("cartera_account_id")) {
      form.setValue(
        "cartera_account_id",
        defaultCarteraId(form.getValues("kind")),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts]);

  function onKindChange(next: ChequeKind) {
    form.setValue("kind", next);
    form.setValue("cartera_account_id", defaultCarteraId(next));
  }

  function onSubmit(values: FormValues) {
    if (!values.cartera_account_id) {
      toast.error(
        "Configurá una cuenta de cartera primero (Cheques físicos o e-cheq).",
      );
      return;
    }
    createMut.mutate(
      {
        kind: values.kind,
        check_number: values.check_number,
        bank_name: values.bank_name,
        drawer_name: values.drawer_name,
        drawer_cuit: values.drawer_cuit,
        issue_date: values.issue_date,
        due_date: values.due_date,
        amount: values.amount,
        currency: values.currency,
        cartera_account_id: values.cartera_account_id,
        channel_id: values.channel_id,
        source_kind: "manual",
        notes: values.notes,
      },
      {
        onSuccess: () => {
          toast.success("Cheque registrado.");
          form.reset({
            kind: "fisico",
            check_number: "",
            bank_name: "",
            drawer_name: "",
            drawer_cuit: "",
            issue_date: todayInAR(),
            due_date: todayInAR(),
            amount: "",
            currency: "ARS",
            cartera_account_id: defaultCarteraId("fisico"),
            channel_id: "",
            notes: "",
          });
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo cheque
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo cheque</DialogTitle>
          <DialogDescription>
            Carga manual. Cuando un cliente paga con check vía un recibo, el
            check se va a registrar automáticamente desde el recibo (en una
            iteración siguiente).
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px]">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Tipo</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => onKindChange(v as ChequeKind)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper">
                        {CHECK_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {CHECK_KIND_LABEL[k]}
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
                name="check_number"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Número de check</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej. 00012345" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Moneda</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as ChequeCurrency)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper">
                        {CHEQUE_CURRENCIES.map((c) => (
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

            <FormField
              control={form.control}
              name="channel_id"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Canal</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir canal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper">
                      {channels
                        .filter((c) => c.is_active)
                        .map((c) => (
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

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="bank_name"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Banco emisor</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej. Banco Galicia" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cartera_account_id"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Cuenta de cartera</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elegir cuenta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper">
                        {carteraOptions.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="drawer_name"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">
                      Firmante (razón social)
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej. Cliente SRL" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="drawer_cuit"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">
                      CUIT firmante (opcional)
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="30-12345678-9" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="issue_date"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Fecha de emisión</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Fecha de cobro</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-xs">Monto</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                      />
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
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs">Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={createMut.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Registrando…" : "Registrar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
