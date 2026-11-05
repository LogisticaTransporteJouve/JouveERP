import { Button } from "@/components/ui/button";

/** The Cancel + submit row of a create/edit form dialog: both right-aligned,
 *  Cancel first; in edit mode submit stays disabled until the form is dirty. */
export function DialogFormFooter({
  mode,
  isSaving,
  isDirty,
  createLabel,
  submitDisabled = false,
  onCancel,
}: {
  mode: "create" | "edit";
  isSaving: boolean;
  isDirty: boolean;
  createLabel: string;
  /** Something the form says next to the footer is still missing. */
  submitDisabled?: boolean;
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
        disabled={isSaving || submitDisabled || (mode === "edit" && !isDirty)}
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
