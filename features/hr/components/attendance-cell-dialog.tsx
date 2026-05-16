"use client";

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
  useDeleteAttendance,
  useUpsertAttendance,
} from "../hooks/use-attendance";
import {
  ATTENDANCE_KIND_LABEL,
  ATTENDANCE_KINDS,
  type AttendanceKind,
  type AttendanceRecord,
} from "../attendance-schema";

type FormValues = {
  kind: AttendanceKind;
  hours_lost: string;
  notes: string;
};

// Manual kinds — los sync (leave / holiday) no se pueden setear desde el UI.
const MANUAL_KINDS: AttendanceKind[] = [
  "absent_justified",
  "absent_unjustified",
  "late",
  "early_leave",
  "sick",
];

export function AttendanceCellDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  date,
  existing,
  year,
  month,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  date: string;
  existing: AttendanceRecord | null;
  year: number;
  month: number;
}) {
  const upsertMut = useUpsertAttendance();
  const deleteMut = useDeleteAttendance();
  const isSyncRow = existing?.source !== undefined && existing.source !== "manual";

  const form = useForm<FormValues>({
    defaultValues: {
      kind: (MANUAL_KINDS.includes(existing?.kind as AttendanceKind)
        ? (existing?.kind as AttendanceKind)
        : "absent_justified"),
      hours_lost:
        existing?.hours_lost != null ? String(existing.hours_lost) : "",
      notes: existing?.notes ?? "",
    },
  });

  function onSubmit(values: FormValues) {
    const hours = values.hours_lost.trim();
    upsertMut.mutate(
      {
        employee_id: employeeId,
        date,
        kind: values.kind,
        hours_lost: hours === "" ? null : Number(hours),
        notes: values.notes || null,
        year,
        month,
      },
      {
        onSuccess: () => {
          toast.success("Excepción guardada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onDelete() {
    if (!existing || existing.source !== "manual") return;
    deleteMut.mutate(
      { id: existing.id, year, month },
      {
        onSuccess: () => {
          toast.success("Excepción eliminada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const busy = upsertMut.isPending || deleteMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {date}
            {isSyncRow ? (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · auto desde{" "}
                {existing?.source === "leave_sync" ? "licencia" : "feriado"}
                {" "}— editá la fuente para cambiar
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSyncRow}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ATTENDANCE_KINDS.map((k) => (
                        <SelectItem
                          key={k}
                          value={k}
                          disabled={!MANUAL_KINDS.includes(k)}
                        >
                          {ATTENDANCE_KIND_LABEL[k]}
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
              name="hours_lost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Horas perdidas (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="decimal"
                      placeholder="ej. 2.5"
                      disabled={isSyncRow}
                    />
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
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} disabled={isSyncRow} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex justify-between sm:justify-between">
              <div>
                {existing && existing.source === "manual" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onDelete}
                    disabled={busy}
                  >
                    Borrar
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                {!isSyncRow && (
                  <Button type="submit" disabled={busy}>
                    {busy ? "Guardando…" : existing ? "Guardar" : "Registrar"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
