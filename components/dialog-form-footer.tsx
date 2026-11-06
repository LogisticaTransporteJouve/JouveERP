import { DisabledHint, NO_CHANGES_REASON } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";

/** The Cancel + submit row of a create/edit form dialog: both right-aligned,
 *  Cancel first; in edit mode submit stays disabled until the form is dirty. */
export function DialogFormFooter({
  mode,
  isSaving,
  isDirty,
  createLabel,
  submitDisabledReason = null,
  onCancel,
}: {
  mode: "create" | "edit";
  isSaving: boolean;
  isDirty: boolean;
  createLabel: string;
  /** Something the form says next to the footer is still missing: it blocks
   *  submit and the button explains it on hover. */
  submitDisabledReason?: string | null;
  onCancel: () => void;
}) {
  const reason = isSaving
    ? null
    : (submitDisabledReason ??
      (mode === "edit" && !isDirty ? NO_CHANGES_REASON : null));
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
      <DisabledHint reason={reason}>
        <Button type="submit" disabled={isSaving || reason !== null}>
          {isSaving
            ? "Guardando…"
            : mode === "create"
              ? createLabel
              : "Guardar cambios"}
        </Button>
      </DisabledHint>
    </div>
  );
}
