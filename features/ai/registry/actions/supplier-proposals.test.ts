import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const searchSuppliersAction = vi.fn();
const findSupplierByCuitAction = vi.fn();
const listSupplierCategoriesAction = vi.fn();
const listCostTagOptionsAction = vi.fn();
const createSupplier = vi.fn();
const updateSupplier = vi.fn();

vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  searchSuppliersAction,
  findSupplierByCuitAction,
}));
vi.mock(
  "@/features/supplier-categories/actions/supplier-categories-actions",
  () => ({ listSupplierCategoriesAction }),
);
vi.mock("@/features/cost-centers/actions/cost-tag-options-actions", () => ({
  listCostTagOptionsAction,
}));
vi.mock("@/lib/commands/create-supplier", () => ({ createSupplier }));
vi.mock("@/lib/commands/update-supplier", () => ({ updateSupplier }));

const { proposeSupplier, proposeSupplierUpdate } =
  await import("./supplier-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const CATEGORY = "00000000-0000-4000-8000-0000000000b1";
// A valid CUIT (check digit).
const CUIT = "30711111111";

const stored = {
  id: SUPPLIER,
  legal_name: "Proveedor SA",
  display_name: null,
  cuit: CUIT,
  is_fiscal: true,
  is_active: true,
  iva_condition: "responsable_inscripto",
  email: null,
  phone: "011 4444-0000",
  address: null,
  real_address: null,
  notes: null,
  default_channel_id: null,
  default_payment_term_days: null,
  default_expense_account_id: null,
  default_cost_center_id: null,
  category_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  findSupplierByCuitAction.mockResolvedValue({ ok: true, data: null });
  searchSuppliersAction.mockResolvedValue({
    ok: true,
    data: { suppliers: [stored], nextOffset: null },
  });
  listSupplierCategoriesAction.mockResolvedValue({
    ok: true,
    data: [{ id: CATEGORY, name: "Combustibles", is_active: true }],
  });
});

describe("proposeSupplier", () => {
  const prepare = (input: Record<string, unknown>) =>
    proposeSupplier.proposal?.prepareDraft(ctx, input);

  it("drafts a Compras supplier the form would create", async () => {
    const prepared = await prepare({
      legal_name: "Transportes Sur SRL",
      cuit: "30-71111111-1",
      iva_condition: "responsable_inscripto",
      payment_term_days: 30,
      category: "combustibles",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      is_fiscal: true,
      cuit: CUIT,
      legal_name: "Transportes Sur SRL",
      default_payment_term_days: 30,
      category_id: CATEGORY,
    });
    const rows = Object.fromEntries(
      prepared.summary.map((r) => [r.label, r.value]),
    );
    expect(rows["Categoría"]).toBe("Combustibles");
    expect(rows["Plazo de pago"]).toBe("30 días");
  });

  it("asks for the IVA condition instead of assuming it", async () => {
    const prepared = await prepare({ legal_name: "Sur SRL", cuit: CUIT });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.issues[0]?.field).toBe("iva_condition");
  });

  it("asks which side when there is no CUIT", async () => {
    const prepared = await prepare({ legal_name: "Gomería Pepe" });
    expect(prepared?.kind).toBe("issues");
  });

  it("refuses a CUIT already loaded", async () => {
    findSupplierByCuitAction.mockResolvedValue({ ok: true, data: stored });
    const prepared = await prepare({
      legal_name: "Otro",
      cuit: CUIT,
      iva_condition: "monotributo",
    });
    expect(prepared).toEqual({
      kind: "error",
      error: "Ya existe un proveedor con ese CUIT: Proveedor SA.",
    });
  });

  it("creates through the form's command on accept", async () => {
    createSupplier.mockResolvedValue({ ok: true, data: { id: SUPPLIER } });
    const prepared = await prepare({
      legal_name: "Gomería Pepe",
      is_fiscal: false,
    });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    const res = await proposeSupplier.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: SUPPLIER } });
    expect(createSupplier).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ is_fiscal: false, legal_name: "Gomería Pepe" }),
    );
  });
});

describe("proposeSupplierUpdate", () => {
  const prepare = (input: Record<string, unknown>) =>
    proposeSupplierUpdate.proposal?.prepareDraft(ctx, {
      supplier: "Proveedor SA",
      ...input,
    });

  it("sends only what changes, with the value it had", async () => {
    const prepared = await prepare({
      phone: "011 4444-0000",
      email: "pagos@proveedor.com",
      payment_term_days: 45,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toEqual({
      id: SUPPLIER,
      email: "pagos@proveedor.com",
      default_payment_term_days: 45,
    });
    const rows = Object.fromEntries(
      prepared.summary.map((r) => [r.label, r.value]),
    );
    expect(rows["Email"]).toBe("— → pagos@proveedor.com");
    expect(rows["Plazo de pago"]).toBe("— → 45 días");
  });

  it("refuses when nothing would change", async () => {
    const prepared = await prepare({ phone: "011 4444-0000" });
    expect(prepared?.kind).toBe("error");
  });

  it("refuses a fiscal field on an Otras compras supplier", async () => {
    searchSuppliersAction.mockResolvedValue({
      ok: true,
      data: {
        suppliers: [{ ...stored, is_fiscal: false, cuit: null }],
        nextOffset: null,
      },
    });
    const prepared = await prepare({ iva_condition: "monotributo" });
    expect(prepared?.kind).toBe("error");
  });

  it("asks when the name matches several suppliers", async () => {
    searchSuppliersAction.mockResolvedValue({
      ok: true,
      data: {
        suppliers: [
          { ...stored, legal_name: "Proveedor SA Norte" },
          { ...stored, id: CATEGORY, legal_name: "Proveedor SA Sur" },
        ],
        nextOffset: null,
      },
    });
    const prepared = await prepare({ email: "x@y.com" });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.candidates?.[0]?.options).toHaveLength(2);
  });
});
