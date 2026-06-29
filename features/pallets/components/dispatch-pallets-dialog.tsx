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

import { useDispatchPalletsBulk } from "../hooks/use-pallets";

const FormSchema = z.object({
  exit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
});

type FormValues = z.infer<typeof FormSchema>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    defaultValues: { exit_date: today() },
  });

  useEffect(() => {
    if (open) form.reset({ exit_date: today() });
  }, [open, form]);

  function onSubmit(values: FormValues) {
    dispatchMut.mutate(
      { ids: palletIds, exit_date: values.exit_date },
      {
        onSuccess: (data) => {
          toast.success(`${data.dispatched} pallets despachados.`);
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
                    <Input {...field} type="date" />
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
              <Button type="submit" disabled={isSaving || count === 0}>
                Despachar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
