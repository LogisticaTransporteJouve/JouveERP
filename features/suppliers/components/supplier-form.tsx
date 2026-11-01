"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  CounterpartyIdentityFields,
  type CounterpartyIdentityValues,
  sideValues,
} from "@/components/counterparty-identity-fields";
import { DialogFormFooter } from "@/components/dialog-form-footer";
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

import {
  usePageIsFiscal,
  useScope,
} from "@/components/providers/scope-provider";
import { useSupplierCategoriesList } from "@/features/supplier-categories/hooks/use-supplier-categories";

import { findSupplierByCuitAction } from "../actions/suppliers-actions";
import { useCreateSupplier, useUpdateSupplier } from "../hooks/use-suppliers";
import type { Supplier } from "../schema";

type Mode = "create" | "edit";

type FormValues = CounterpartyIdentityValues & {
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
  isFiscal: isFiscalProp,
  initialValues,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  supplier?: Supplier;
  /** Create mode: the side to create on; defaults to the page's side. */
  isFiscal?: boolean;
  /** Create mode: CUIT / razón social to start from (e.g. read from a document). */
  initialValues?: { cuit: string | null; legal_name: string | null };
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const isSaving = createMut.isPending || updateMut.isPending;
  const pageIsFiscal = usePageIsFiscal();
  // A supplier's side never changes: edit follows the record.
  const isFiscal = supplier?.is_fiscal ?? isFiscalProp ?? pageIsFiscal ?? true;
  const { channels } = useScope();
  const activeChannels = useMemo(
    () => channels.filter((c) => c.is_active && c.is_fiscal === isFiscal),
    [channels, isFiscal],
  );
  const categoriesQuery = useSupplierCategoriesList({ onlyActive: true });
  const categories = categoriesQuery.data ?? [];

  const form = useForm<FormValues>({
    defaultValues: {
      ...supplierToValues(supplier),
      ...(initialValues?.cuit
        ? { cuit: initialValues.cuit.replace(/\D/g, "") }
        : {}),
      ...(initialValues?.legal_name
        ? { legal_name: initialValues.legal_name }
        : {}),
    },
  });

  function onSubmit(formValues: FormValues) {
    const values = sideValues(formValues, isFiscal);
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <CounterpartyIdentityFields
          mode={mode}
          isFiscal={isFiscal}
          entityId={supplier?.id}
          noun="proveedor"
          existingHref={(id) => `/suppliers/${id}`}
          findByCuit={findSupplierByCuitAction}
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

        <DialogFormFooter
          mode={mode}
          isSaving={isSaving}
          isDirty={form.formState.isDirty}
          createLabel="Crear proveedor"
          onCancel={() => (onCancel ? onCancel() : router.push("/suppliers"))}
        />
      </form>
    </Form>
  );
}
