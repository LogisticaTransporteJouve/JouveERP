"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  CounterpartyIdentityFields,
  sideValues,
  type CounterpartyIdentityValues,
} from "@/components/counterparty-identity-fields";
import { usePageIsFiscal } from "@/components/providers/scope-provider";
import { DialogFormFooter } from "@/components/dialog-form-footer";
import { Form } from "@/components/ui/form";

import { findClientByCuitAction } from "../actions/clients-actions";
import { useCreateClient, useUpdateClient } from "../hooks/use-clients";
import type { Client } from "../schema";

type Mode = "create" | "edit";

type FormValues = CounterpartyIdentityValues;

/** A client not loaded yet, as a bank line names it. */
export type ClientSuggestion = { cuit: string | null; name: string };

function clientToValues(
  client: Client | undefined,
  initial?: ClientSuggestion,
): FormValues {
  return {
    cuit: client?.cuit ?? initial?.cuit ?? "",
    legal_name: client?.legal_name ?? initial?.name ?? "",
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
  isFiscal: isFiscalProp,
  initial,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  client?: Client;
  /** Create mode: what is already known of the client (a bank line's). */
  initial?: ClientSuggestion;
  /** Create mode: the side to create on; defaults to the page's side. */
  isFiscal?: boolean;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const pageIsFiscal = usePageIsFiscal();
  // A client's side never changes: edit follows the record.
  const isFiscal = client?.is_fiscal ?? isFiscalProp ?? pageIsFiscal ?? true;
  const createMut = useCreateClient();
  const updateMut = useUpdateClient();
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    defaultValues: clientToValues(client, initial),
  });

  function onSubmit(formValues: FormValues) {
    const values = sideValues(formValues, isFiscal);
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
          isFiscal={isFiscal}
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
