"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Suspense, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  useCreateRecurringTask,
  useCreateTask,
  useUpdateRecurringTask,
} from "../hooks/use-tasks";
import type { RecurringTask } from "../schema";

import { AssigneePicker } from "./assignee-picker";

const FormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "El título es obligatorio.")
      .max(200, "Máx 200 caracteres."),
    description: z.string().max(2000, "Máx 2000 caracteres."),
    recurring: z.boolean(),
    due_date: z.string(),
    day_of_month: z.string(),
    assignee_ids: z.array(z.string()),
  })
  .refine(
    (v) =>
      !v.recurring ||
      (Number.isInteger(Number(v.day_of_month)) &&
        Number(v.day_of_month) >= 1 &&
        Number(v.day_of_month) <= 31),
    { path: ["day_of_month"], message: "Día entre 1 y 31." },
  );

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(recurring?: RecurringTask): FormValues {
  return {
    title: recurring?.title ?? "",
    description: recurring?.description ?? "",
    recurring: recurring !== undefined,
    due_date: "",
    day_of_month: recurring ? String(recurring.day_of_month) : "1",
    assignee_ids: recurring?.assignee_ids ?? [],
  };
}

/** "Nueva tarea" (one-off or monthly), or editing a recurrence. */
export function TaskFormDialog({
  open,
  onOpenChange,
  recurring,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edits this recurrence instead of creating a task. */
  recurring?: RecurringTask;
}) {
  const createTask = useCreateTask();
  const createRecurring = useCreateRecurringTask();
  const updateRecurring = useUpdateRecurringTask();
  const isSaving =
    createTask.isPending ||
    createRecurring.isPending ||
    updateRecurring.isPending;
  const isEdit = recurring !== undefined;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(recurring),
  });
  const repeats = useWatch({ control: form.control, name: "recurring" });

  useEffect(() => {
    if (open) form.reset(toDefaults(recurring));
  }, [open, recurring, form]);

  function done(message: string) {
    toast.success(message);
    onOpenChange(false);
  }

  function onSubmit(values: FormValues) {
    const onError = (err: Error) => toast.error(err.message);
    const common = {
      title: values.title,
      description: values.description,
      assignee_ids: values.assignee_ids,
    };
    if (isEdit) {
      updateRecurring.mutate(
        { id: recurring.id, ...common, day_of_month: values.day_of_month },
        { onSuccess: () => done("Tarea recurrente guardada."), onError },
      );
    } else if (values.recurring) {
      createRecurring.mutate(
        { ...common, day_of_month: values.day_of_month },
        { onSuccess: () => done("Tarea recurrente creada."), onError },
      );
    } else {
      createTask.mutate(
        { ...common, due_date: values.due_date || null },
        { onSuccess: () => done("Tarea creada."), onError },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar tarea recurrente" : "Nueva tarea"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Los cambios aplican a las próximas ocurrencias."
              : "Una tarea para vos o para otros. Si se repite, se crea sola todos los meses."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Llamar al cliente por la factura vencida"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Detalle (opcional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isEdit && (
              <FormField
                control={form.control}
                name="recurring"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Se repite todos los meses</FormLabel>
                      <FormDescription>
                        Ej.: cierre de mes el día 1, impuestos el día 5.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            {repeats ? (
              <FormField
                control={form.control}
                name="day_of_month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día del mes</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={31}
                      />
                    </FormControl>
                    <FormDescription>
                      Si el mes es más corto, vence el último día.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vencimiento (opcional)</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        clearable
                        className="w-full"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="assignee_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsables</FormLabel>
                  <Suspense fallback={<Skeleton className="h-9 w-full" />}>
                    <FormControl>
                      <AssigneePicker
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                  </Suspense>
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
              <Button type="submit" disabled={isSaving}>
                {isEdit ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
