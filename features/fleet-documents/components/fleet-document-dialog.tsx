"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  useCreateFleetDocument,
  useUpdateFleetDocument,
} from "../hooks/use-fleet-documents";
import {
  FLEET_DOC_KINDS,
  FLEET_DOC_KIND_LABELS,
  type FleetDocument,
} from "../schema";

const FormSchema = z.object({
  owner_kind: z.enum(["vehicle", "driver"]),
  owner_id: z.string().min(1, "Elegí un vehículo o un chofer."),
  kind: z.enum(FLEET_DOC_KINDS),
  number: z.string().trim().max(120),
  issued_at: z.string(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(doc?: FleetDocument): FormValues {
  const ownerKind: "vehicle" | "driver" = doc?.driver_id ? "driver" : "vehicle";
  return {
    owner_kind: ownerKind,
    owner_id:
      (ownerKind === "driver" ? doc?.driver_id : doc?.vehicle_id) ?? "",
    kind: doc?.kind ?? "vtv",
    number: doc?.number ?? "",
    issued_at: doc?.issued_at ?? "",
    expires_at: doc?.expires_at ?? "",
    notes: doc?.notes ?? "",
  };
}

export function FleetDocumentDialog({
  mode,
  doc,
  vehicleOptions,
  driverOptions,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  doc?: FleetDocument;
  vehicleOptions: { id: string; patente: string }[];
  driverOptions: { id: string; full_name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateFleetDocument();
  const updateMut = useUpdateFleetDocument();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(doc),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(doc));
  }, [open, doc, form]);

  const ownerKind = form.watch("owner_kind");

  function onSubmit(values: FormValues) {
    const owner =
      values.owner_kind === "vehicle"
        ? { vehicle_id: values.owner_id, driver_id: null }
        : { driver_id: values.owner_id, vehicle_id: null };
    const payload = {
      ...owner,
      kind: values.kind,
      number: values.number,
      issued_at: values.issued_at,
      expires_at: values.expires_at,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Documento creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (doc) {
      updateMut.mutate(
        { id: doc.id, ...payload },
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar documento" : "Nuevo documento"}
          </DialogTitle>
          <DialogDescription>
            Documentación vencible de un vehículo o un chofer (VTV, seguro,
            licencia, ART, etc.).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="owner_kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dueño</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("owner_id", "", { shouldDirty: true });
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="vehicle">Vehículo</SelectItem>
                        <SelectItem value="driver">Chofer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="owner_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {ownerKind === "vehicle" ? "Vehículo" : "Chofer"}
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              ownerKind === "vehicle"
                                ? "Seleccionar vehículo"
                                : "Seleccionar chofer"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ownerKind === "vehicle"
                          ? vehicleOptions.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.patente}
                              </SelectItem>
                            ))
                          : driverOptions.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.full_name}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FLEET_DOC_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {FLEET_DOC_KIND_LABELS[k]}
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
                name="number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>N°</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Póliza / nro." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="issued_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emisión</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expires_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vencimiento</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
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
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || (isEdit && !form.formState.isDirty)}
              >
                {isEdit ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
