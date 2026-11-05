"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ReadError } from "@/components/read-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
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
import { formatArgentineDate, todayInAR } from "@/lib/format";

import {
  useCreateLeave,
  useDeleteLeave,
  useEmployeeLeaves,
  useVacationBalances,
} from "../hooks/use-vacations";
import { currentVacationPeriodYear } from "../lib/vacation-periods";
import {
  LEAVE_KIND_LABEL,
  LEAVE_KINDS,
  VACATION_BALANCE_STATUS_LABEL,
  type LeaveKind,
} from "../vacation-schema";

import { VacationOpeningDialog } from "./vacation-opening-dialog";

type FormValues = {
  start_date: string;
  end_date: string;
  kind: LeaveKind;
  notes: string;
};

export function EmployeeVacationsCard({
  employeeId,
  employeeName,
  hireDate,
  actorAccess,
}: {
  employeeId: string;
  employeeName: string;
  hireDate: string;
  actorAccess: Access;
}) {
  const canWrite = userCan(actorAccess, "hr:write");
  const canSetVacations = userCan(actorAccess, "hr:admin");
  const balancesQuery = useVacationBalances(employeeId);
  const leavesQuery = useEmployeeLeaves(employeeId);
  const balances = balancesQuery.data ?? [];
  const leaves = leavesQuery.data ?? [];
  const balancesLoading = balancesQuery.isLoading;
  const leavesLoading = leavesQuery.isLoading;
  // A failed read is not "none": «Cargar saldo» would prefill 0 pending days
  // and overwrite the stored ones, a new leave could be loaded twice.
  const balancesFailed = balancesQuery.isError && !balancesQuery.data;
  const leavesFailed = leavesQuery.isError && !leavesQuery.data;
  const createMut = useCreateLeave();
  const deleteMut = useDeleteLeave();

  const activeBalance = balances.find((b) => b.status !== "expired");
  const period = currentVacationPeriodYear(todayInAR());
  const currentBalance = balances.find((b) => b.period_year === period);
  const previousPending = balances
    .filter((b) => b.period_year < period && b.status !== "expired")
    .reduce((sum, b) => sum + Math.max(b.remaining_days, 0), 0);

  return (
    <div className="space-y-6">
      {canSetVacations && !balancesLoading && !balancesFailed && (
        <div className="flex justify-end">
          <VacationOpeningDialog
            employeeId={employeeId}
            employeeName={employeeName}
            hireDate={hireDate}
            currentDays={
              currentBalance
                ? currentBalance.entitled_days + currentBalance.bonus_days
                : null
            }
            previousDays={previousPending}
          />
        </div>
      )}
      <BalancesSection
        balances={balances}
        loading={balancesLoading}
        onRetry={
          balancesFailed ? () => void balancesQuery.refetch() : undefined
        }
      />

      <LeavesSection
        leaves={leaves}
        loading={leavesLoading}
        onRetry={leavesFailed ? () => void leavesQuery.refetch() : undefined}
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

      {canWrite && !leavesFailed && (
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
  onRetry,
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
  /** Set when the read failed. */
  onRetry: (() => void) | undefined;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Saldos de vacaciones</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : onRetry ? (
        <ReadError
          message="No se pudieron leer los saldos."
          onRetry={onRetry}
        />
      ) : balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin saldos. Se generan solos el 1 de octubre de cada año; los días de
          antes de usar la app se cargan con “Cargar saldo”.
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
  onRetry,
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
  /** Set when the read failed. */
  onRetry: (() => void) | undefined;
  canWrite: boolean;
  onDelete: (id: string) => void;
  deleteBusy: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Licencias</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : onRetry ? (
        <ReadError
          message="No se pudieron leer las licencias."
          onRetry={onRetry}
        />
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
                      <IconButton
                        label="Borrar"
                        variant="ghost"
                        className="size-7"
                        onClick={() => onDelete(leave.id)}
                        disabled={deleteBusy}
                      >
                        {deleteBusy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5 text-destructive" />
                        )}
                      </IconButton>
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
      start_date: todayInAR(),
      end_date: todayInAR(),
      kind: "vacaciones",
      notes: "",
    },
  });

  function onSubmit(values: FormValues) {
    onCreate(values);
    form.reset({
      start_date: todayInAR(),
      end_date: todayInAR(),
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
