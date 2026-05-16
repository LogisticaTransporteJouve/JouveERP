"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";

import {
  useCreateChartAccount,
  useUpdateChartAccount,
} from "../hooks/use-chart-of-accounts";
import {
  COA_ACCOUNT_TYPES,
  COA_ACCOUNT_TYPE_LABEL,
  COA_SYSTEM_ROLES,
  COA_SYSTEM_ROLE_LABEL,
  compareCodes,
  levelFromCode,
  suggestChildCode,
  type ChartAccount,
  type CoaAccountType,
  type CoaSystemRole,
} from "../schema";

type Mode = "create" | "edit";

type FormValues = {
  parent_id: string | null;
  code: string;
  name: string;
  account_type: CoaAccountType;
  eerr_category: string;
  system_role: CoaSystemRole | "__none";
  is_active: boolean;
};

const NONE_ROLE = "__none" as const;

type Props = {
  mode: Mode;
  account?: ChartAccount;
  parentSuggestion?: ChartAccount;
  allAccounts: readonly ChartAccount[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChartAccountDialog({
  mode,
  account,
  parentSuggestion,
  allAccounts,
  open,
  onOpenChange,
}: Props) {
  const createMut = useCreateChartAccount();
  const updateMut = useUpdateChartAccount();
  const isSaving = createMut.isPending || updateMut.isPending;

  const possibleParents = useMemo(() => {
    if (mode === "edit") return [];
    return [...allAccounts]
      .filter((a) => a.is_active && a.level < 8)
      .sort((a, b) => compareCodes(a.code, b.code));
  }, [allAccounts, mode]);

  const initialParent =
    parentSuggestion ??
    (mode === "create" && account ? account : undefined);

  const form = useForm<FormValues>({
    defaultValues: {
      parent_id: initialParent?.id ?? null,
      code: account?.code ?? "",
      name: account?.name ?? "",
      account_type:
        account?.account_type ??
        initialParent?.account_type ??
        "activo",
      eerr_category: account?.eerr_category ?? initialParent?.eerr_category ?? "",
      system_role: (account?.system_role ?? NONE_ROLE) as
        | CoaSystemRole
        | typeof NONE_ROLE,
      is_active: account?.is_active ?? true,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      parent_id: initialParent?.id ?? null,
      code: account?.code ?? "",
      name: account?.name ?? "",
      account_type:
        account?.account_type ?? initialParent?.account_type ?? "activo",
      eerr_category:
        account?.eerr_category ?? initialParent?.eerr_category ?? "",
      system_role: (account?.system_role ?? NONE_ROLE) as
        | CoaSystemRole
        | typeof NONE_ROLE,
      is_active: account?.is_active ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id, parentSuggestion?.id]);

  const parentId = form.watch("parent_id");

  useEffect(() => {
    if (mode !== "create") return;
    if (!parentId) {
      form.setValue("code", "");
      return;
    }
    const parent = allAccounts.find((a) => a.id === parentId);
    if (!parent) return;
    const siblingCodes = allAccounts
      .filter((a) => a.parent_id === parent.id)
      .map((a) => a.code);
    form.setValue("code", suggestChildCode(parent.code, siblingCodes));
    form.setValue("account_type", parent.account_type);
    if (parent.eerr_category) {
      form.setValue("eerr_category", parent.eerr_category);
    }
  }, [parentId, allAccounts, mode, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      parent_id: values.parent_id,
      code: values.code,
      name: values.name,
      account_type: values.account_type,
      eerr_category:
        values.eerr_category.trim().length > 0 ? values.eerr_category.trim() : null,
      system_role:
        values.system_role === NONE_ROLE ? null : values.system_role,
      is_active: values.is_active,
    };

    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Cuenta creada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (account) {
      updateMut.mutate(
        {
          id: account.id,
          name: payload.name,
          account_type: payload.account_type,
          eerr_category: payload.eerr_category,
          system_role: payload.system_role,
          is_active: payload.is_active,
        },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  const isEdit = mode === "edit";
  const codePreviewLevel = form.watch("code")
    ? levelFromCode(form.watch("code"))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar cuenta" : "Nueva cuenta"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cambiá datos no estructurales de la cuenta. Código y padre no se modifican una vez creada."
              : "Elegí la cuenta padre y el sistema sugiere el siguiente código disponible."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!isEdit && (
              <FormField
                control={form.control}
                name="parent_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuenta padre</FormLabel>
                    <Select
                      value={field.value ?? "__root"}
                      onValueChange={(v) =>
                        field.onChange(v === "__root" ? null : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar padre…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__root">
                          (sin padre — capítulo raíz)
                        </SelectItem>
                        {possibleParents.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="font-mono text-xs">{p.code}</span>{" "}
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Sin padre = nivel 1 (capítulo). Con padre, el código se
                      autogenera.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem className="col-span-1">
                    <FormLabel>Código</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isEdit}
                        placeholder="1.1.1"
                        autoComplete="off"
                        className="font-mono"
                      />
                    </FormControl>
                    {codePreviewLevel !== null && !isEdit && (
                      <FormDescription className="text-xs">
                        Nivel {codePreviewLevel}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Ej: Caja general"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="account_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo contable</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v as CoaAccountType)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COA_ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {COA_ACCOUNT_TYPE_LABEL[t]}
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
              name="eerr_category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría EERR</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ej: gastos_operativos"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Opcional. Agrupa la cuenta en el Estado de Resultados.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="system_role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rol del sistema</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as CoaSystemRole | typeof NONE_ROLE)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_ROLE}>(ninguno)</SelectItem>
                      {COA_SYSTEM_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {COA_SYSTEM_ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Asigna la cuenta como destino de un tipo de asiento
                    automático (caja, IVA débito, etc.). Solo una cuenta activa
                    puede tener un rol dado.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="space-y-0.5">
                    <FormLabel className="cursor-pointer">Activa</FormLabel>
                    <FormDescription className="text-xs">
                      Las cuentas inactivas no aparecen en los pickers ni
                      reciben asientos automáticos.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  isSaving || (isEdit && !form.formState.isDirty)
                }
              >
                {isSaving
                  ? "Guardando…"
                  : isEdit
                    ? "Guardar cambios"
                    : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
