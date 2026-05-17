"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  useCreateEmployeeDocument,
  useUpdateEmployeeDocument,
} from "../hooks/use-employee-documents";
import {
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYEE_DOCUMENT_KIND_LABEL,
  type EmployeeDocument,
  type EmployeeDocumentKind,
} from "../schema";

const FormSchema = z
  .object({
    kind: z.enum(EMPLOYEE_DOCUMENT_KINDS),
    number: z.string().trim().max(120).optional(),
    issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional().or(z.literal("")),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vencimiento requerida."),
    issuing_authority: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (d) => !d.issued_at || d.expires_at >= d.issued_at,
    {
      message: "Vencimiento debe ser posterior a la emisión.",
      path: ["expires_at"],
    },
  );

type FormValues = z.infer<typeof FormSchema>;

type Mode =
  | { mode: "create"; employeeId: string; document?: undefined }
  | { mode: "edit"; employeeId: string; document: EmployeeDocument };

export function EmployeeDocumentDialog(
  props: Mode & {
    trigger?: ReactNode;
  },
) {
  const [open, setOpen] = useState(false);
  const createMut = useCreateEmployeeDocument();
  const updateMut = useUpdateEmployeeDocument(props.employeeId);
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      kind: (props.document?.kind ?? "licencia_conducir") as EmployeeDocumentKind,
      number: props.document?.number ?? "",
      issued_at: props.document?.issued_at ?? "",
      expires_at: props.document?.expires_at ?? "",
      issuing_authority: props.document?.issuing_authority ?? "",
      notes: props.document?.notes ?? "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      kind: (props.document?.kind ?? "licencia_conducir") as EmployeeDocumentKind,
      number: props.document?.number ?? "",
      issued_at: props.document?.issued_at ?? "",
      expires_at: props.document?.expires_at ?? "",
      issuing_authority: props.document?.issuing_authority ?? "",
      notes: props.document?.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSubmit(values: FormValues) {
    const payload = {
      kind: values.kind,
      number: values.number?.trim() ? values.number : null,
      issued_at: values.issued_at || null,
      expires_at: values.expires_at,
      issuing_authority: values.issuing_authority?.trim()
        ? values.issuing_authority
        : null,
      notes: values.notes?.trim() ? values.notes : null,
    };

    if (props.mode === "create") {
      createMut.mutate(
        { employee_id: props.employeeId, ...payload },
        {
          onSuccess: () => {
            toast.success("Documento creado.");
            setOpen(false);
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : "Error"),
        },
      );
      return;
    }
    updateMut.mutate(
      { id: props.document.id, ...payload },
      {
        onSuccess: () => {
          toast.success("Documento actualizado.");
          setOpen(false);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Error"),
      },
    );
  }

  const trigger = props.trigger ?? (
    <Button size="sm">
      <Plus className="mr-1 size-4" /> Nuevo documento
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "create" ? "Nuevo documento" : "Editar documento"}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "Cargá un papel vencible (carnet, libreta, curso, etc.)."
              : "Actualizá los datos del documento."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
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
                      {EMPLOYEE_DOCUMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {EMPLOYEE_DOCUMENT_KIND_LABEL[k]}
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
                  <FormLabel>Número (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej. 12345678 / Cat. C2"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="issued_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emisión (opcional)</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
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
                      <DatePicker
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="issuing_authority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Autoridad emisora (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej. Municipalidad de Tigre / CNRT"
                      {...field}
                      value={field.value ?? ""}
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
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Categoría, condiciones, etc."
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || !form.formState.isDirty}
              >
                {props.mode === "create" ? "Crear" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
