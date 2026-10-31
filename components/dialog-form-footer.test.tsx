// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DialogFormFooter } from "./dialog-form-footer";

afterEach(cleanup);

function renderFooter(
  props: Partial<Parameters<typeof DialogFormFooter>[0]> = {},
) {
  const onCancel = vi.fn();
  render(
    <DialogFormFooter
      mode="create"
      isSaving={false}
      isDirty={false}
      createLabel="Crear cliente"
      onCancel={onCancel}
      {...props}
    />,
  );
  return {
    onCancel,
    submit: screen.getByRole("button", {
      name: /Crear cliente|Guardar cambios|Guardando…/,
    }),
    cancel: screen.getByRole("button", { name: "Cancelar" }),
  };
}

describe("DialogFormFooter", () => {
  it("puts Cancel before the submit button", () => {
    const { cancel, submit } = renderFooter();
    expect(
      cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("create mode submits even when the form is pristine", () => {
    const { submit } = renderFooter();
    expect(submit.textContent).toBe("Crear cliente");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("edit mode waits for a change before submitting", () => {
    const pristine = renderFooter({ mode: "edit" });
    expect(pristine.submit.textContent).toBe("Guardar cambios");
    expect((pristine.submit as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const dirty = renderFooter({ mode: "edit", isDirty: true });
    expect((dirty.submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables both buttons while saving", () => {
    const { submit, cancel } = renderFooter({ isSaving: true });
    expect(submit.textContent).toBe("Guardando…");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel calls onCancel", () => {
    const { cancel, onCancel } = renderFooter();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
