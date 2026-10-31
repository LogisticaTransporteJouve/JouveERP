import { Button } from "@/components/ui/button";

/** The Cancel + submit row of a create/edit form dialog: both right-aligned,
 *  Cancel first; in edit mode submit stays disabled until the form is dirty. */
export function DialogFormFooter({
  mode,
  isSaving,
  isDirty,
  createLabel,
  onCancel,
}: {
  mode: "create" | "edit";
  isSaving: boolean;
  isDirty: boolean;
  createLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        disabled={isSaving}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        disabled={isSaving || (mode === "edit" && !isDirty)}
      >
        {isSaving
          ? "Guardando…"
          : mode === "create"
            ? createLabel
            : "Guardar cambios"}
      </Button>
    </div>
  );
}
