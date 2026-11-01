"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
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
  IVA_CONDITIONS,
  IVA_CONDITION_LABEL,
  type IvaCondition,
} from "@/features/clients/schema";
import { useCuitVerify } from "@/hooks/use-cuit-verify";
import { formatCuitInput } from "@/lib/validation/cuit";
import type { ActionResult } from "@/lib/query/run-action";

/** The identity fields a client and a supplier share. */
export type CounterpartyIdentityValues = {
  cuit: string;
  legal_name: string;
  display_name: string;
  /** Empty for an internal counterparty, which has none. */
  iva_condition: IvaCondition | "";
  email: string;
  phone: string;
  address: string;
  real_address: string;
  notes: string;
};

type Counterparty = { id: string; legal_name: string };

/** The form values as a create / update payload for the record's side: an
 *  internal counterparty sends no CUIT, IVA condition or fiscal address. */
export function sideValues<V extends CounterpartyIdentityValues>(
  values: V,
  isFiscal: boolean,
) {
  if (isFiscal) return { ...values, is_fiscal: true as const };
  return {
    ...values,
    cuit: undefined,
    iva_condition: undefined,
    address: undefined,
    is_fiscal: false as const,
  };
}

/**
 * CUIT (with "Verificar AFIP"), razón social, condición de IVA, contact and
 * addresses of a client or supplier form. Lives inside the form's `<Form>`
 * provider; the AFIP lookup fills razón social, IVA and domicilio fiscal and
 * flags a CUIT another record of the same kind already uses.
 *
 * An internal counterparty (Otras ventas / Otras compras) has no CUIT, IVA
 * condition or fiscal address: only a typed name, contact and notes.
 */
export function CounterpartyIdentityFields<T extends Counterparty>({
  mode,
  isFiscal = true,
  entityId,
  noun,
  existingHref,
  findByCuit,
}: {
  mode: "create" | "edit";
  isFiscal?: boolean;
  /** The record being edited, so its own CUIT is not reported as taken. */
  entityId?: string;
  noun: "cliente" | "proveedor";
  existingHref: (id: string) => string;
  findByCuit: (cuit: string) => Promise<ActionResult<T | null>>;
}) {
  const form = useFormContext<CounterpartyIdentityValues>();
  const [existing, setExisting] = useState<T | null>(null);
  const { verify, isVerifying } = useCuitVerify<T>({ findByCuit });

  async function onVerifyCuit() {
    const cuit = form.getValues("cuit");
    setExisting(null);

    const result = await verify(cuit, entityId);
    if (!result) return;

    if (result.kind === "existing") {
      setExisting(result.entity);
      toast.warning(`Ya existe un ${noun} con ese CUIT.`);
      return;
    }
    if (result.kind === "error") {
      toast.error(result.error);
      return;
    }

    const data = result.data;
    form.setValue("legal_name", data.legal_name);
    form.setValue("iva_condition", data.tax_condition);
    if (data.fiscal_address) {
      const parts = [
        data.fiscal_address.street,
        data.fiscal_address.city,
        data.fiscal_address.province,
        data.fiscal_address.postal_code,
      ].filter((part) => part && part.length > 0);
      form.setValue("address", parts.join(", "));
    }
    toast.success(
      result.fromCache
        ? `Cargado desde caché${result.stale ? " (datos viejos)" : ""}.`
        : "Cargado desde AFIP.",
    );
  }

  const cuitLocked = mode === "edit";
  const fromCuitPlaceholder =
    mode === "create" ? "Se completa al verificar el CUIT" : undefined;

  return (
    <>
      {isFiscal && (
        <>
          <div className="grid gap-2">
            <FormField
              control={form.control}
              name="cuit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CUIT</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        {...field}
                        value={formatCuitInput(field.value ?? "")}
                        onChange={(e) =>
                          field.onChange(formatCuitInput(e.target.value))
                        }
                        placeholder="30-71463743-2"
                        inputMode="numeric"
                        disabled={cuitLocked || isVerifying}
                        autoComplete="off"
                      />
                    </FormControl>
                    {!cuitLocked && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onVerifyCuit}
                        disabled={isVerifying || !field.value}
                      >
                        {isVerifying ? "Verificando…" : "Verificar AFIP"}
                      </Button>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            {existing && (
              <div className="rounded-md border border-border bg-muted p-3 text-sm">
                Ya existe el {noun}{" "}
                <Link
                  href={existingHref(existing.id)}
                  className="font-medium underline"
                >
                  {existing.legal_name}
                </Link>
                .
              </div>
            )}
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="legal_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{isFiscal ? "Razón social" : "Nombre"}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={isFiscal}
                  autoComplete="off"
                  placeholder={isFiscal ? fromCuitPlaceholder : undefined}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre fantasía</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {isFiscal && (
        <FormField
          control={form.control}
          name="iva_condition"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Condición frente al IVA</FormLabel>
              <FormControl>
                <Select value={field.value} disabled>
                  <SelectTrigger className="w-full sm:w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {IVA_CONDITIONS.map((condition) => (
                      <SelectItem key={condition} value={condition}>
                        {IVA_CONDITION_LABEL[condition]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="off"
                  placeholder={`contacto@${noun}.com`}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Teléfono</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {isFiscal && (
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Domicilio fiscal (AFIP)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled
                  autoComplete="off"
                  placeholder={fromCuitPlaceholder}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="real_address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{isFiscal ? "Domicilio real" : "Domicilio"}</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete="off"
                placeholder={
                  isFiscal
                    ? "Sólo completar si difiere del domicilio fiscal"
                    : undefined
                }
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
              <Textarea {...field} rows={3} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
