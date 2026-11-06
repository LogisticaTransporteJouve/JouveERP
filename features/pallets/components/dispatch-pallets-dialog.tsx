"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DisabledHint } from "@/components/disabled-hint";
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
import { todayInAR } from "@/lib/format";

import { useDispatchPalletsBulk } from "../hooks/use-pallets";

const FormSchema = z.object({
  exit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
});

type FormValues = z.infer<typeof FormSchema>;

export function DispatchPalletsDialog({
  palletIds,
  open,
  onOpenChange,
  onDispatched,
}: {
  palletIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatched: () => void;
}) {
  const dispatchMut = useDispatchPalletsBulk();
  const isSaving = dispatchMut.isPending;
  const count = palletIds.length;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { exit_date: todayInAR() },
  });

  useEffect(() => {
    if (open) form.reset({ exit_date: todayInAR() });
  }, [open, form]);

  function onSubmit(values: FormValues) {
    dispatchMut.mutate(
      { ids: palletIds, exit_date: values.exit_date },
      {
        onSuccess: (data) => {
          toast.success(`${data.dispatched} pallets despachados.`);
          if (data.blocked > 0) {
            toast.warning(
              `${data.blocked} pallets quedaron en depósito porque están bloqueados.`,
            );
          }
          onDispatched();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Despachar pallets</DialogTitle>
          <DialogDescription>
            Vas a dar salida a {count} pallet{count === 1 ? "" : "s"}. Se cobra
            la descarga y se corta el almacenaje en la fecha de salida.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="exit_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de salida</FormLabel>
                  <FormControl>
                    <DatePicker {...field} />
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
              <DisabledHint
                reason={count === 0 ? "No hay pallets elegidos." : null}
              >
                <Button type="submit" disabled={isSaving || count === 0}>
                  Despachar
                </Button>
              </DisabledHint>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
