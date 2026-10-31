"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  CounterpartyIdentityFields,
  type CounterpartyIdentityValues,
} from "@/components/counterparty-identity-fields";
import { DialogFormFooter } from "@/components/dialog-form-footer";
import { Form } from "@/components/ui/form";

import { findClientByCuitAction } from "../actions/clients-actions";
import { useCreateClient, useUpdateClient } from "../hooks/use-clients";
import type { Client } from "../schema";

type Mode = "create" | "edit";

type FormValues = CounterpartyIdentityValues;

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

  const form = useForm<FormValues>({
    defaultValues: clientToValues(client),
  });

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: (data) => {
          toast.success("Cliente creado.");
          if (onSuccess) onSuccess(data.id);
          else router.push(`/clients/${data.id}`);
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <CounterpartyIdentityFields
          mode={mode}
          entityId={client?.id}
          noun="cliente"
          existingHref={(id) => `/clients/${id}`}
          findByCuit={findClientByCuitAction}
        />

        <DialogFormFooter
          mode={mode}
          isSaving={isSaving}
          isDirty={form.formState.isDirty}
          createLabel="Crear cliente"
          onCancel={() => (onCancel ? onCancel() : router.push("/clients"))}
        />
      </form>
    </Form>
  );
}
