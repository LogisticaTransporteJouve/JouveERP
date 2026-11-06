"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { DisabledHint, NO_CHANGES_REASON } from "@/components/disabled-hint";
import { cn } from "@/lib/utils";
import { FormColumn, FormColumns } from "@/components/form-columns";
import { DIALOG_STICKY_FOOTER } from "@/components/ui/dialog";
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
import { MoneyInput } from "@/components/money-input";
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

import { amountToInput, parseArAmount, todayInAR } from "@/lib/format";

import { runAction } from "@/lib/query/run-action";

import { getEmployeeDriverAction } from "../actions/employees-actions";
import { useCreateEmployee, useUpdateEmployee } from "../hooks/use-employees";
import {
  currentVacationPeriodYear,
  suggestedVacationDays,
} from "../lib/vacation-periods";
import {
  EMPLOYEE_POSITIONS,
  isDriverPosition,
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
  vacation_current_days: string;
  vacation_previous_days: string;
  license_number: string;
  license_category: string;
  driver_phone: string;
  convenio: string;
  categoria: string;
  obra_social: string;
  art: string;
  retribucion_formal: string;
};

function employeeToValues(employee: Employee | undefined): FormValues {
  return {
    legal_name: employee?.legal_name ?? "",
    position: employee?.position ?? "",
    cuil: employee?.cuil ?? "",
    cbu: employee?.cbu ?? "",
    pay_frequency: (employee?.pay_frequency ?? "mensual") as PayFrequency,
    base_salary:
      employee?.base_salary != null ? amountToInput(employee.base_salary) : "",
    viatico_monthly:
      employee?.viatico_monthly != null
        ? amountToInput(employee.viatico_monthly)
        : "20.000",
    is_monotributo: employee?.is_monotributo ?? false,
    hire_date: employee?.hire_date ?? todayInAR(),
    notes: employee?.notes ?? "",
    vacation_current_days: "",
    vacation_previous_days: "",
    license_number: "",
    license_category: "",
    driver_phone: "",
    convenio: employee?.convenio ?? "",
    categoria: employee?.categoria ?? "",
    obra_social: employee?.obra_social ?? "",
    art: employee?.art ?? "",
    retribucion_formal:
      employee?.retribucion_formal != null
        ? amountToInput(employee.retribucion_formal)
        : "",
  };
}

/** An es-AR amount ("850.000" → 850000); blank stays blank (not loaded). */
function moneyField(raw: string): number | "" {
  return raw.trim() === "" ? "" : (parseArAmount(raw) ?? Number.NaN);
}

/** The employee's own fields: the vacation days go to their balances. */
function withoutVacationFields(values: FormValues) {
  return {
    legal_name: values.legal_name,
    position: values.position,
    cuil: values.cuil,
    cbu: values.cbu,
    pay_frequency: values.pay_frequency,
    base_salary: moneyField(values.base_salary),
    viatico_monthly: moneyField(values.viatico_monthly),
    is_monotributo: values.is_monotributo,
    hire_date: values.hire_date,
    notes: values.notes,
    convenio: values.convenio,
    categoria: values.categoria,
    obra_social: values.obra_social,
    art: values.art,
    retribucion_formal: moneyField(values.retribucion_formal),
    // Driver data only travels with a driver position.
    ...(isDriverPosition(values.position)
      ? {
          license_number: values.license_number,
          license_category: values.license_category,
          driver_phone: values.driver_phone,
        }
      : {}),
  };
}

export function EmployeeForm({
  mode,
  employee,
  onSuccess,
  onCancel,
  canSetVacations = false,
}: {
  mode: Mode;
  /** Create mode, owner/admin: show the vacation days fields. */
  canSetVacations?: boolean;
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

  const hireDate = useWatch({ control: form.control, name: "hire_date" });
  const position = useWatch({ control: form.control, name: "position" });
  const isDriver = isDriverPosition(position);

  // Edit: the driver data lives on the employee's driver record.
  const { data: driver } = useQuery({
    queryKey: ["employees", "driver", employee?.id ?? null],
    queryFn: () => runAction(() => getEmployeeDriverAction(employee?.id ?? "")),
    enabled: mode === "edit" && !!employee,
  });
  useEffect(() => {
    if (!driver) return;
    form.setValue("license_number", driver.license_number ?? "");
    form.setValue("license_category", driver.license_category ?? "");
    form.setValue("driver_phone", driver.phone ?? "");
  }, [driver, form]);

  // Rows saved before the positions list keep their free text as an option.
  const positionOptions: string[] =
    employee?.position &&
    !(EMPLOYEE_POSITIONS as readonly string[]).includes(employee.position)
      ? [...EMPLOYEE_POSITIONS, employee.position]
      : [...EMPLOYEE_POSITIONS];
  const vacationPeriod = currentVacationPeriodYear(todayInAR());
  const suggestedDays = /^\d{4}-\d{2}-\d{2}$/.test(hireDate)
    ? suggestedVacationDays(hireDate, vacationPeriod)
    : null;

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      const employeeValues = withoutVacationFields(values);
      const withVacations = canSetVacations
        ? {
            ...employeeValues,
            vacation_current_days: values.vacation_current_days.trim() || null,
            vacation_previous_days:
              values.vacation_previous_days.trim() || null,
          }
        : employeeValues;
      createMut.mutate(withVacations, {
        onSuccess: (data) => {
          toast.success("Empleado creado.");
          if (onSuccess) onSuccess(data.id);
          else router.push(`/employees/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (employee) {
      updateMut.mutate(
        { id: employee.id, ...withoutVacationFields(values) },
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
        <FormColumns>
          <FormColumn>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elegí una posición" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {positionOptions.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="base_salary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sueldo base mensual</FormLabel>
                    <FormControl>
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormDescription>
                      El sueldo pactado. Un chofer mensual lleva su sueldo acá;
                      vacío solo para quien cobra semanal.
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
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormDescription>Default $20.000.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="hire_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de ingreso</FormLabel>
                    <FormControl>
                      <DatePicker {...field} />
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

            {isDriver && (
              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <h3 className="text-sm font-medium">Datos de chofer</h3>
                  <p className="text-xs text-muted-foreground">
                    Aparece en Flota → Choferes para asignarle viajes.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="license_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N.º de licencia</FormLabel>
                        <FormControl>
                          <Input {...field} autoComplete="off" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="license_category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoría</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="off"
                            placeholder="E1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="driver_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teléfono</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="off"
                            inputMode="tel"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}
          </FormColumn>
          <FormColumn>
            <div className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-medium">Datos formales</h3>
                <p className="text-xs text-muted-foreground">
                  Lo que figura en el recibo del liquidador. Opcional.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(
                  [
                    ["convenio", "Convenio", "Ej. CCT 40/89 Camioneros"],
                    ["categoria", "Categoría", "Ej. 1.ª categoría"],
                    ["obra_social", "Obra social", ""],
                    ["art", "ART", ""],
                  ] as const
                ).map(([name, label, placeholder]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{label}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="off"
                            placeholder={placeholder}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
                <FormField
                  control={form.control}
                  name="retribucion_formal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Retribución formal</FormLabel>
                      <FormControl>
                        <MoneyInput {...field} />
                      </FormControl>
                      <FormDescription>
                        Bruto del recibo. Solo informativo.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {mode === "create" && canSetVacations && (
              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <h3 className="text-sm font-medium">Vacaciones</h3>
                  <p className="text-xs text-muted-foreground">
                    Opcional. Si lo dejás vacío, el período nuevo se otorga solo
                    el 1 de octubre.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="vacation_current_days"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Días del período en curso ({vacationPeriod}-
                          {vacationPeriod + 1})
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            placeholder={
                              suggestedDays !== null
                                ? String(suggestedDays)
                                : ""
                            }
                            autoComplete="off"
                          />
                        </FormControl>
                        <FormDescription>
                          {suggestedDays !== null
                            ? `Por antigüedad le corresponden ${suggestedDays} días (LCT art. 150).`
                            : "Según la antigüedad: 14, 21, 28 o 35 días."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vacation_previous_days"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Días pendientes de años anteriores
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            placeholder="0"
                            autoComplete="off"
                          />
                        </FormControl>
                        <FormDescription>
                          Lo que le queda sin tomar de períodos anteriores. Se
                          usa primero.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

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
          </FormColumn>
        </FormColumns>
        <div className={cn("flex justify-end gap-2", DIALOG_STICKY_FOOTER)}>
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
          <DisabledHint
            reason={
              mode === "edit" && !form.formState.isDirty
                ? NO_CHANGES_REASON
                : null
            }
          >
            <Button
              type="submit"
              disabled={
                isSaving || (mode === "edit" && !form.formState.isDirty)
              }
            >
              {isSaving
                ? "Guardando…"
                : mode === "create"
                  ? "Crear empleado"
                  : "Guardar cambios"}
            </Button>
          </DisabledHint>
        </div>
      </form>
    </Form>
  );
}
