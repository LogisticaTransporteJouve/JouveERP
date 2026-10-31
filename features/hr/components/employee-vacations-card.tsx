"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import {
  useCreateLeave,
  useDeleteLeave,
  useEmployeeLeaves,
  useVacationBalances,
} from "../hooks/use-vacations";
import {
  LEAVE_KIND_LABEL,
  LEAVE_KINDS,
  VACATION_BALANCE_STATUS_LABEL,
  type LeaveKind,
} from "../vacation-schema";

type FormValues = {
  start_date: string;
  end_date: string;
  kind: LeaveKind;
  notes: string;
};

export function EmployeeVacationsCard({
  employeeId,
  actorAccess,
}: {
  employeeId: string;
  actorAccess: Access;
}) {
  const canWrite = userCan(actorAccess, "hr:write");
  const { data: balances = [], isLoading: balancesLoading } =
    useVacationBalances(employeeId);
  const { data: leaves = [], isLoading: leavesLoading } =
    useEmployeeLeaves(employeeId);
  const createMut = useCreateLeave();
  const deleteMut = useDeleteLeave();

  const activeBalance = balances.find((b) => b.status !== "expired");

  return (
    <div className="space-y-6">
      <BalancesSection balances={balances} loading={balancesLoading} />

      <LeavesSection
        leaves={leaves}
        loading={leavesLoading}
        canWrite={canWrite}
        onDelete={(id) =>
          deleteMut.mutate(
            { id, employee_id: employeeId },
            {
              onSuccess: () => toast.success("Licencia eliminada."),
              onError: (err) => toast.error(err.message),
            },
          )
        }
        deleteBusy={deleteMut.isPending}
      />

      {canWrite && (
        <NewLeaveForm
          employeeId={employeeId}
          remaining={activeBalance?.remaining_days ?? 0}
          submitting={createMut.isPending}
          onCreate={(values) =>
            createMut.mutate(
              {
                employee_id: employeeId,
                ...values,
                notes: values.notes || null,
              },
              {
                onSuccess: () => toast.success("Licencia registrada."),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        />
      )}
    </div>
  );
}

function BalancesSection({
  balances,
  loading,
}: {
  balances: Array<{
    id: string;
    period_year: number;
    entitled_days: number;
    bonus_days: number;
    carryover_days: number;
    used_days: number;
    remaining_days: number;
    granted_at: string;
    expires_at: string;
    status: "active" | "expired" | "extended";
  }>;
  loading: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Saldos de vacaciones</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin saldos. Generá las balances anuales desde Admin → HR.
        </p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Otorgados</TableHead>
                <TableHead className="text-right">Bonus</TableHead>
                <TableHead className="text-right">Arrastre</TableHead>
                <TableHead className="text-right">Usados</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Expira</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.period_year}</TableCell>
                  <TableCell className="text-right font-mono">
                    {b.entitled_days}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {b.bonus_days}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {b.carryover_days}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {b.used_days}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-semibold ${
                      b.remaining_days < 0
                        ? "text-foreground dark:text-foreground"
                        : b.remaining_days === 0
                          ? "text-muted-foreground"
                          : "text-muted-foreground dark:text-muted-foreground"
                    }`}
                  >
                    {b.remaining_days}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatArgentineDate(b.expires_at)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={b.status === "active" ? "outline" : "secondary"}
                      className="text-xs"
                    >
                      {VACATION_BALANCE_STATUS_LABEL[b.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LeavesSection({
  leaves,
  loading,
  canWrite,
  onDelete,
  deleteBusy,
}: {
  leaves: Array<{
    id: string;
    start_date: string;
    end_date: string;
    days: number | null;
    kind: LeaveKind;
    notes: string | null;
  }>;
  loading: boolean;
  canWrite: boolean;
  onDelete: (id: string) => void;
  deleteBusy: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Licencias</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : leaves.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin licencias registradas.
        </p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desde</TableHead>
                <TableHead>Hasta</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaves.map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell className="text-sm">
                    {formatArgentineDate(leave.start_date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatArgentineDate(leave.end_date)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {leave.days ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {LEAVE_KIND_LABEL[leave.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {leave.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => onDelete(leave.id)}
                        disabled={deleteBusy}
                        aria-label="Borrar"
                      >
                        {deleteBusy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5 text-destructive" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function NewLeaveForm({
  employeeId: _employeeId,
  remaining,
  submitting,
  onCreate,
}: {
  employeeId: string;
  remaining: number;
  submitting: boolean;
  onCreate: (values: FormValues) => void;
}) {
  const form = useForm<FormValues>({
    defaultValues: {
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      kind: "vacaciones",
      notes: "",
    },
  });

  function onSubmit(values: FormValues) {
    onCreate(values);
    form.reset({
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      kind: values.kind,
      notes: "",
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">Nueva licencia</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Días corridos (incluye fines de semana). Si es de tipo vacaciones,
        descuenta del saldo activo (FIFO).
        {remaining > 0 && ` Saldo disponible: ${remaining} días.`}
      </p>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-3 grid grid-cols-2 gap-3"
        >
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Desde</FormLabel>
                <FormControl>
                  <Input {...field} type="date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hasta</FormLabel>
                <FormControl>
                  <Input {...field} type="date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LEAVE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {LEAVE_KIND_LABEL[k]}
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
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notas</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={1} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="col-span-2 flex justify-end">
            <Button type="submit" disabled={submitting}>
              <Plus className="size-4" />
              {submitting ? "Guardando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
