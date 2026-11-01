// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Form } from "@/components/ui/form";

import {
  CounterpartyIdentityFields,
  type CounterpartyIdentityValues,
} from "./counterparty-identity-fields";

const h = vi.hoisted(() => ({
  verifyCuitAction: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/clients/actions/afip-actions", () => ({
  verifyCuitAction: h.verifyCuitAction,
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const EMPTY: CounterpartyIdentityValues = {
  cuit: "",
  legal_name: "",
  display_name: "",
  iva_condition: "responsable_inscripto",
  email: "",
  phone: "",
  address: "",
  real_address: "",
  notes: "",
};

function Harness({
  findByCuit,
  noun = "cliente",
}: {
  findByCuit: (
    cuit: string,
  ) => Promise<
    | { ok: true; data: { id: string; legal_name: string } | null }
    | { ok: false; error: string }
  >;
  noun?: "cliente" | "proveedor";
}) {
  const form = useForm<CounterpartyIdentityValues>({ defaultValues: EMPTY });
  return (
    <Form {...form}>
      <form>
        <CounterpartyIdentityFields
          mode="create"
          noun={noun}
          existingHref={(id) => `/${noun}s/${id}`}
          findByCuit={findByCuit}
        />
      </form>
    </Form>
  );
}

function typeCuitAndVerify(cuit: string) {
  fireEvent.change(screen.getByLabelText("CUIT"), {
    target: { value: cuit },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verificar AFIP" }));
}

afterEach(cleanup);
beforeEach(() => {
  h.verifyCuitAction.mockReset();
  for (const fn of Object.values(h.toast)) fn.mockReset();
});

describe("CounterpartyIdentityFields", () => {
  it("fills razón social, IVA and domicilio fiscal from AFIP", async () => {
    h.verifyCuitAction.mockResolvedValue({
      ok: true,
      fromCache: false,
      data: {
        legal_name: "ACME SA",
        tax_condition: "monotributo",
        fiscal_address: {
          street: "Av. Siempre Viva 123",
          city: "CABA",
          province: "",
          postal_code: "1000",
        },
      },
    });
    render(<Harness findByCuit={async () => ({ ok: true, data: null })} />);
    typeCuitAndVerify("30714637432");
    expect(await screen.findByDisplayValue("ACME SA")).toBeTruthy();
    expect(
      screen.getByDisplayValue("Av. Siempre Viva 123, CABA, 1000"),
    ).toBeTruthy();
    expect(screen.getAllByText("Monotributo").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Responsable Inscripto")).toHaveLength(1);
    expect(h.toast.success).toHaveBeenCalledWith("Cargado desde AFIP.");
  });

  it("links to the record that already uses the CUIT, without asking AFIP", async () => {
    render(
      <Harness
        noun="proveedor"
        findByCuit={async () => ({
          ok: true,
          data: { id: "s1", legal_name: "Proveedor Existente" },
        })}
      />,
    );
    typeCuitAndVerify("30714637432");
    const link = await screen.findByRole("link", {
      name: "Proveedor Existente",
    });
    expect(link.getAttribute("href")).toBe("/proveedors/s1");
    expect(screen.getByText(/Ya existe el proveedor/)).toBeTruthy();
    expect(h.toast.warning).toHaveBeenCalledWith(
      "Ya existe un proveedor con ese CUIT.",
    );
    expect(h.verifyCuitAction).not.toHaveBeenCalled();
  });

  it("shows the AFIP error", async () => {
    h.verifyCuitAction.mockResolvedValue({ ok: false, error: "CUIT inválido" });
    render(<Harness findByCuit={async () => ({ ok: true, data: null })} />);
    typeCuitAndVerify("1");
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("CUIT inválido"),
    );
    expect(screen.queryByDisplayValue("ACME SA")).toBeNull();
  });
});
