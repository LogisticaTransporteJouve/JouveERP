"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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

import { useScope } from "@/components/providers/scope-provider";
import { useSupplierCategoriesList } from "@/features/supplier-categories/hooks/use-supplier-categories";
import { useCuitVerify } from "@/hooks/use-cuit-verify";

import { findSupplierByCuitAction } from "../actions/suppliers-actions";
import { useCreateSupplier, useUpdateSupplier } from "../hooks/use-suppliers";
import {
  IVA_CONDITIONS,
  IVA_CONDITION_LABEL,
  type Supplier,
  type IvaCondition,
} from "../schema";

type Mode = "create" | "edit";

type FormValues = {
  cuit: string;
  legal_name: string;
  display_name: string;
  iva_condition: IvaCondition;
  email: string;
  phone: string;
  address: string;
  real_address: string;
  notes: string;
  default_channel_id: string;
  default_payment_term_days: string;
  category_id: string;
};

function supplierToValues(
  supplier:
    | (Supplier & {
        default_channel_id?: string | null;
        default_payment_term_days?: number | null;
        category_id?: string | null;
      })
    | undefined,
): FormValues {
  return {
    cuit: supplier?.cuit ?? "",
    legal_name: supplier?.legal_name ?? "",
    display_name: supplier?.display_name ?? "",
    iva_condition: supplier?.iva_condition ?? "responsable_inscripto",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    real_address: supplier?.real_address ?? "",
    notes: supplier?.notes ?? "",
    default_channel_id: supplier?.default_channel_id ?? "",
    default_payment_term_days:
      supplier?.default_payment_term_days != null
        ? String(supplier.default_payment_term_days)
        : "",
    category_id: supplier?.category_id ?? "",
  };
}

export function SupplierForm({
  mode,
  supplier,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  supplier?: Supplier;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const isSaving = createMut.isPending || updateMut.isPending;
  const [existingSupplier, setExistingSupplier] = useState<Supplier | null>(
    null,
  );
  const { verify, isVerifying } = useCuitVerify<Supplier>({
    findByCuit: findSupplierByCuitAction,
  });

  const { channels } = useScope();
  const activeChannels = useMemo(
    () => channels.filter((c) => c.is_active),
    [channels],
  );
  const categoriesQuery = useSupplierCategoriesList({ onlyActive: true });
  const categories = categoriesQuery.data ?? [];

  const form = useForm<FormValues>({
    defaultValues: supplierToValues(supplier),
  });

  async function onVerifyCuit() {
    const cuit = form.getValues("cuit");
    setExistingSupplier(null);

    const result = await verify(cuit, supplier?.id);
    if (!result) return;

    if (result.kind === "existing") {
      setExistingSupplier(result.entity);
      toast.warning("Ya existe un proveedor con ese CUIT.");
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

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: (data) => {
          toast.success("Proveedor creado.");
          if (onSuccess) onSuccess(data.id);
          else router.push(`/suppliers`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (supplier) {
      updateMut.mutate(
        { id: supplier.id, ...values },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            if (onSuccess) onSuccess(supplier.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  const cuitLocked = mode === "edit";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                      placeholder="30714637432"
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
          {existingSupplier && (
            <div className="rounded-md border border-border bg-muted p-3 text-sm">
              Ya existe el proveedor{" "}
              <Link
                href={`/suppliers/${existingSupplier.id}`}
                className="font-medium underline"
              >
                {existingSupplier.legal_name}
              </Link>
              .
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="legal_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Razón social</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled
                    autoComplete="off"
                    placeholder={
                      mode === "create"
                        ? "Se completa al verificar el CUIT"
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
                    placeholder="contacto@proveedor.com"
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
                  placeholder={
                    mode === "create"
                      ? "Se completa al verificar el CUIT"
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
          name="real_address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Domicilio real</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  placeholder="Sólo completar si difiere del domicilio fiscal"
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

        <div className="space-y-4 rounded-md border bg-muted/10 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Defaults para compras</h3>
            <p className="text-xs text-muted-foreground">
              Opcional. Pre-completan campos al cargar una factura de este
              proveedor. Siempre se pueden sobreescribir.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="default_channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal por defecto</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value || "__none"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sin default</SelectItem>
                        {activeChannels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            {c.is_fiscal ? " · fiscal" : " · interno"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="default_payment_term_days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Días de pago default</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      placeholder="Ej: 30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="category_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoría</FormLabel>
                <FormControl>
                  <Select
                    value={field.value || "__none"}
                    onValueChange={(v) =>
                      field.onChange(v === "__none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Sin categoría</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (onCancel ? onCancel() : router.push("/suppliers"))}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSaving || (mode === "edit" && !form.formState.isDirty)}
          >
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Crear proveedor"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
