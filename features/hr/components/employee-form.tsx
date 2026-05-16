"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useCreateEmployee, useUpdateEmployee } from "../hooks/use-employees";
import {
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABEL,
  type Employee,
  type PayFrequency,
} from "../schema";

type Mode = "create" | "edit";

type FormValues = {
  legal_name: string;
  position: string;
  cuil: string;
  cbu: string;
  pay_frequency: PayFrequency;
  base_salary: string;
  viatico_monthly: string;
  is_monotributo: boolean;
  hire_date: string;
  notes: string;
};

function employeeToValues(employee: Employee | undefined): FormValues {
  return {
    legal_name: employee?.legal_name ?? "",
    position: employee?.position ?? "",
    cuil: employee?.cuil ?? "",
    cbu: employee?.cbu ?? "",
    pay_frequency: (employee?.pay_frequency ?? "mensual") as PayFrequency,
    base_salary:
      employee?.base_salary != null ? String(employee.base_salary) : "",
    viatico_monthly:
      employee?.viatico_monthly != null
        ? String(employee.viatico_monthly)
        : "20000",
    is_monotributo: employee?.is_monotributo ?? false,
    hire_date: employee?.hire_date ?? new Date().toISOString().slice(0, 10),
    notes: employee?.notes ?? "",
  };
}

export function EmployeeForm({
  mode,
  employee,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  employee?: Employee;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const createMut = useCreateEmployee();
  const updateMut = useUpdateEmployee();
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    defaultValues: employeeToValues(employee),
  });

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: (data) => {
          toast.success("Empleado creado.");
          if (onSuccess) onSuccess(data.id);
          else router.push(`/employees/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (employee) {
      updateMut.mutate(
        { id: employee.id, ...values },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            if (onSuccess) onSuccess(employee.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="legal_name"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Apellido y nombre</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="Pérez, Juan"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="position"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Posición</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="Chofer, Administrativo, Mecánico…"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pay_frequency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Frecuencia de pago</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PAY_FREQUENCIES.map((freq) => (
                      <SelectItem key={freq} value={freq}>
                        {PAY_FREQUENCY_LABEL[freq]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="cuil"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CUIL</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="20123456784"
                  />
                </FormControl>
                <FormDescription>11 dígitos. Opcional.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cbu"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CBU</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="0000000000000000000000"
                  />
                </FormControl>
                <FormDescription>
                  22 dígitos. Opcional, pero requerido para pagar por
                  transferencia.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="base_salary"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sueldo base mensual</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.01"
                    min="0"
                    autoComplete="off"
                  />
                </FormControl>
                <FormDescription>
                  Vacío para choferes que cobran semanal — sólo el viático va
                  por planilla mensual.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="viatico_monthly"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Viático mensual</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.01"
                    min="0"
                    autoComplete="off"
                  />
                </FormControl>
                <FormDescription>Default $20.000.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="hire_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha de ingreso</FormLabel>
                <FormControl>
                  <Input {...field} type="date" autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="is_monotributo"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Monotributista</FormLabel>
                <div className="flex items-center gap-2 pt-1">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">
                    Factura como monotributista (la factura se carga en
                    Compras).
                  </span>
                </div>
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
              <FormLabel>Notas</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  placeholder="Cualquier dato relevante: convenio, observaciones, etc."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSaving || (mode === "edit" && !form.formState.isDirty)}
          >
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Crear empleado"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
