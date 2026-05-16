"use client";

import { UserMinus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  useReactivateEmployee,
  useTerminateEmployee,
} from "../hooks/use-employees";
import type { Employee } from "../schema";

type FormValues = {
  termination_date: string;
  notes: string;
};

export function TerminateEmployeeDialog({ employee }: { employee: Employee }) {
  const [open, setOpen] = useState(false);
  const terminateMut = useTerminateEmployee();
  const reactivateMut = useReactivateEmployee();
  const isTerminated = !employee.is_active && !!employee.termination_date;

  const form = useForm<FormValues>({
    defaultValues: {
      termination_date: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  function onSubmit(values: FormValues) {
    if (isTerminated) {
      reactivateMut.mutate(employee.id, {
        onSuccess: () => {
          toast.success("Empleado reactivado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      });
      return;
    }
    terminateMut.mutate(
      {
        id: employee.id,
        termination_date: values.termination_date,
        notes: values.notes || null,
      },
      {
        onSuccess: () => {
          toast.success("Empleado dado de baja.");
          setOpen(false);
          form.reset();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const busy = terminateMut.isPending || reactivateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserMinus className="size-4" />
          {isTerminated ? "Reactivar" : "Dar de baja"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {isTerminated ? (
          <>
            <DialogHeader>
              <DialogTitle>Reactivar empleado</DialogTitle>
              <DialogDescription>
                {employee.legal_name} fue dado de baja el{" "}
                {employee.termination_date}. ¿Confirmás la reactivación?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button onClick={() => onSubmit(form.getValues())} disabled={busy}>
                {busy ? "Reactivando…" : "Reactivar"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>Dar de baja a {employee.legal_name}</DialogTitle>
                <DialogDescription>
                  Se marca como inactivo. La info histórica queda intacta.
                </DialogDescription>
              </DialogHeader>
              <FormField
                control={form.control}
                name="termination_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de egreso</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo / notas</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Guardando…" : "Dar de baja"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
