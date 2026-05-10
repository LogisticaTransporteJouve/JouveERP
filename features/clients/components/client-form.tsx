"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

import { useCreateClient, useUpdateClient } from "../hooks/use-clients";
import { useCuitVerify } from "../hooks/use-cuit-verify";
import {
  IVA_CONDITIONS,
  IVA_CONDITION_LABEL,
  type Client,
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
};

function clientToValues(client: Client | undefined): FormValues {
  return {
    cuit: client?.cuit ?? "",
    legal_name: client?.legal_name ?? "",
    display_name: client?.display_name ?? "",
    iva_condition: client?.iva_condition ?? "responsable_inscripto",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    address: client?.address ?? "",
    real_address: client?.real_address ?? "",
    notes: client?.notes ?? "",
  };
}

export function ClientForm({
  mode,
  client,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  client?: Client;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const createMut = useCreateClient();
  const updateMut = useUpdateClient();
  const isSaving = createMut.isPending || updateMut.isPending;
  const [existingClient, setExistingClient] = useState<Client | null>(null);
  const { verify, isVerifying } = useCuitVerify();

  const form = useForm<FormValues>({
    defaultValues: clientToValues(client),
  });

  async function onVerifyCuit() {
    const cuit = form.getValues("cuit");
    setExistingClient(null);

    const result = await verify(cuit, client?.id);
    if (!result) return;

    if (result.kind === "existing") {
      setExistingClient(result.client);
      toast.warning("Ya existe un cliente con ese CUIT.");
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
          toast.success("Cliente creado.");
          if (onSuccess) onSuccess(data.id);
          else router.push(`/clientes/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (client) {
      updateMut.mutate(
        { id: client.id, ...values },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            if (onSuccess) onSuccess(client.id);
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
          {existingClient && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              Ya existe el cliente{" "}
              <Link
                href={`/clientes/${existingClient.id}`}
                className="font-medium underline"
              >
                {existingClient.legal_name}
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
                    placeholder="contacto@cliente.com"
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

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (onCancel ? onCancel() : router.push("/clientes"))}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              isSaving || (mode === "edit" && !form.formState.isDirty)
            }
          >
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Crear cliente"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
