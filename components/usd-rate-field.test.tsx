// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Form } from "@/components/ui/form";
import { amountToInput, COTIZACION_DECIMALS } from "@/lib/format";

import { parseUsdRate, UsdRateField } from "./usd-rate-field";

afterEach(cleanup);

/** A receipt / payment order form's cotización: prefilled like their edit
 *  mode and read on submit the way both read it. */
function Harness({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (rate: number) => void;
}) {
  const form = useForm<{ cotizacion: string }>({
    defaultValues: { cotizacion: initial },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => onSave(parseUsdRate(v.cotizacion)))}
      >
        <UsdRateField
          control={form.control}
          name="cotizacion"
          noLoadedRate={false}
        />
        <button type="submit">Guardar</button>
      </form>
    </Form>
  );
}

function field(): HTMLInputElement {
  const el = screen.getByLabelText("Cotización (ARS por USD)");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

async function save(onSave: ReturnType<typeof vi.fn>): Promise<unknown> {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0]?.[0];
}

describe("UsdRateField", () => {
  it.each([
    ["1.180", "1.180", 1180],
    ["1.180,50", "1.180,50", 1180.5],
  ])("typing %s shows %s and saves %s", async (typed, shown, saved) => {
    const onSave = vi.fn();
    render(<Harness initial="" onSave={onSave} />);
    fireEvent.change(field(), { target: { value: typed } });
    expect(field().value).toBe(shown);
    expect(await save(onSave)).toBe(saved);
  });

  it("shows a stored 1180.5 as 1.180,50 and saves it unchanged", async () => {
    const onSave = vi.fn();
    render(
      <Harness
        initial={amountToInput(1180.5, COTIZACION_DECIMALS)}
        onSave={onSave}
      />,
    );
    expect(field().value).toBe("1.180,50");
    expect(await save(onSave)).toBe(1180.5);
  });
});
