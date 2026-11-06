import { z } from "zod";

import { listCostTagOptionsAction } from "@/features/cost-centers/actions/cost-tag-options-actions";
import type { CostTagOption } from "@/features/cost-centers/schema";
import { listSupplierCategoriesAction } from "@/features/supplier-categories/actions/supplier-categories-actions";
import { findSupplierByCuitAction } from "@/features/suppliers/actions/suppliers-actions";
import {
  IVA_CONDITION_LABEL,
  IVA_CONDITIONS,
  type Supplier,
} from "@/features/suppliers/schema";
import { createSupplier } from "@/lib/commands/create-supplier";
import { updateSupplier } from "@/lib/commands/update-supplier";

import {
  SUPPLIER_LABELS,
  supplierProposalSpec,
  supplierUpdateProposalSpec,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { optionLabel, resolveOption } from "./expense-proposals";
import { findSupplier, supplierName } from "./resolve-supplier";

/** The default account / center / category the user named → its id (null
 *  for "ninguna"), with its label added; or a question. */
type Defaults = {
  category_id?: string | null;
  default_expense_account_id?: string | null;
  default_cost_center_id?: string | null;
};

async function resolveDefaults(
  input: {
    category?: string;
    expense_account?: string;
    cost_center?: string;
  },
  labels: Record<string, string>,
): Promise<
  { kind: "ok"; defaults: Defaults } | { kind: "stop"; result: AiPrepareResult }
> {
  const defaults: Defaults = {};
  if (input.category !== undefined) {
    const res = await listSupplierCategoriesAction({ onlyActive: true });
    if (!res.ok)
      return { kind: "stop", result: { kind: "error", error: res.error } };
    const options: CostTagOption[] = res.data.map((c) => ({
      id: c.id,
      code: c.name,
      name: c.name,
    }));
    const picked = resolveOption("category", input.category, options);
    if (picked.kind === "issues")
      return { kind: "stop", result: picked.result };
    defaults.category_id = picked.id;
    const named = res.data.find((c) => c.id === picked.id);
    if (named) labels[named.id] = named.name;
  }
  if (input.expense_account !== undefined || input.cost_center !== undefined) {
    const res = await listCostTagOptionsAction();
    if (!res.ok)
      return { kind: "stop", result: { kind: "error", error: res.error } };
    const { expenseAccounts, costCenters } = res.data;
    if (input.expense_account !== undefined) {
      const picked = resolveOption(
        "expense_account",
        input.expense_account,
        expenseAccounts,
      );
      if (picked.kind === "issues")
        return { kind: "stop", result: picked.result };
      defaults.default_expense_account_id = picked.id;
      const named = expenseAccounts.find((o) => o.id === picked.id);
      if (named) labels[named.id] = optionLabel(named);
    }
    if (input.cost_center !== undefined) {
      const picked = resolveOption(
        "cost_center",
        input.cost_center,
        costCenters,
      );
      if (picked.kind === "issues")
        return { kind: "stop", result: picked.result };
      defaults.default_cost_center_id = picked.id;
      const named = costCenters.find((o) => o.id === picked.id);
      if (named) labels[named.id] = optionLabel(named);
    }
  }
  return { kind: "ok", defaults };
}

const nameInput = z.string().trim().min(1).max(120);
const termInput = z
  .number()
  .int()
  .min(1)
  .max(365)
  .describe("Plazo de pago habitual en días (1 a 365).");
const lookupInput = z.string().trim().min(1).max(120);

/** The optional fields both supplier proposals take, as the user said them. */
const supplierFieldsInput = {
  display_name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe("Domicilio fiscal (only a supplier with CUIT)."),
  real_address: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  payment_term_days: termInput.optional(),
  category: lookupInput
    .optional()
    .describe("Supplier category by name ('ninguna' = none)."),
  expense_account: lookupInput
    .optional()
    .describe("Default expense account: code or name ('ninguna' = none)."),
  cost_center: lookupInput
    .optional()
    .describe("Default cost center: code or name ('ninguno' = none)."),
};

// ─── Alta ────────────────────────────────────────────────────────────────────

export const proposeSupplier = defineAiProposal({
  name: "proposeSupplier",
  domain: "compras",
  permission: ["suppliers:write", "suppliers:read"],
  sources: [
    "suppliers",
    "supplier_categories",
    "expense_leaf_accounts",
    "cost_centers",
  ],
  description:
    "Propose creating a supplier (alta de proveedor) for the user to accept on " +
    "a card. is_fiscal true = Compras (CUIT and IVA condition required); false " +
    "= Otras compras (no CUIT). Pass only what the user said; the category, " +
    "default expense account and cost center by name. A CUIT already loaded " +
    "is refused. Writes nothing by itself.",
  input: z.object({
    legal_name: nameInput.describe("Razón social (or name, without CUIT)."),
    is_fiscal: z.boolean().optional(),
    cuit: z.string().trim().max(20).optional(),
    iva_condition: z.enum(IVA_CONDITIONS).optional(),
    ...supplierFieldsInput,
  }),
  spec: supplierProposalSpec,
  prepare: async (_ctx, input) => {
    const isFiscal = input.is_fiscal ?? (input.cuit ? true : undefined);
    if (isFiscal === undefined) {
      return {
        kind: "issues",
        issues: [
          {
            field: "is_fiscal",
            message:
              "Falta si es un proveedor de Compras (con CUIT y factura fiscal) o de Otras compras (sin CUIT).",
          },
        ],
        candidates: [
          {
            field: "is_fiscal",
            options: [
              { value: "true", label: "Compras (con CUIT)" },
              { value: "false", label: "Otras compras (sin CUIT)" },
            ],
          },
        ],
      };
    }
    const labels: Record<string, string> = {};
    if (isFiscal) {
      if (!input.cuit) {
        return {
          kind: "issues",
          issues: [{ field: "cuit", message: "Falta el CUIT del proveedor." }],
        };
      }
      if (!input.iva_condition) {
        return {
          kind: "issues",
          issues: [
            { field: "iva_condition", message: "Falta la condición de IVA." },
          ],
          candidates: [
            {
              field: "iva_condition",
              options: IVA_CONDITIONS.map((c) => ({
                value: c,
                label: IVA_CONDITION_LABEL[c],
              })),
            },
          ],
        };
      }
      const existing = await findSupplierByCuitAction(input.cuit);
      if (!existing.ok) return { kind: "error", error: existing.error };
      if (existing.data) {
        return {
          kind: "error",
          error: `Ya existe un proveedor con ese CUIT: ${existing.data.legal_name}.`,
        };
      }
    }
    const resolved = await resolveDefaults(input, labels);
    if (resolved.kind === "stop") return resolved.result;
    const shared = {
      legal_name: input.legal_name,
      display_name: input.display_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      real_address: input.real_address ?? null,
      notes: input.notes ?? null,
      default_payment_term_days: input.payment_term_days ?? null,
      ...resolved.defaults,
    };
    return {
      kind: "draft",
      draft: isFiscal
        ? {
            ...shared,
            is_fiscal: true,
            cuit: input.cuit,
            iva_condition: input.iva_condition,
            address: input.address ?? null,
          }
        : { ...shared, is_fiscal: false },
      labels,
    };
  },
  execute: (ctx, draft) => createSupplier(ctx.userId, draft),
});

// ─── Edición ─────────────────────────────────────────────────────────────────

const ID_FIELDS = [
  "category_id",
  "default_expense_account_id",
  "default_cost_center_id",
] as const;

/** A stored value as the card's "before" reads it. */
function beforeText(
  field: string,
  value: unknown,
  names: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "iva_condition" && typeof value === "string") {
    const label = IVA_CONDITIONS.find((c) => c === value);
    return label ? IVA_CONDITION_LABEL[label] : value;
  }
  if (field === "default_payment_term_days") return `${String(value)} días`;
  const text = String(value);
  return names.get(text) ?? text;
}

/** The id fields' current values named, for the "before" side. */
async function storedNames(supplier: Supplier): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (supplier.category_id) {
    const res = await listSupplierCategoriesAction();
    if (res.ok) for (const c of res.data) names.set(c.id, c.name);
  }
  if (supplier.default_expense_account_id || supplier.default_cost_center_id) {
    const res = await listCostTagOptionsAction();
    if (res.ok) {
      const { expenseAccounts, costCenters, inactiveCostCenters } = res.data;
      for (const o of [
        ...expenseAccounts,
        ...costCenters,
        ...inactiveCostCenters,
      ]) {
        names.set(o.id, optionLabel(o));
      }
    }
  }
  return names;
}

export const proposeSupplierUpdate = defineAiProposal({
  name: "proposeSupplierUpdate",
  domain: "compras",
  permission: ["suppliers:write", "suppliers:read"],
  sources: [
    "suppliers",
    "supplier_categories",
    "expense_leaf_accounts",
    "cost_centers",
  ],
  description:
    "Propose editing a supplier's data (razón social, CUIT, IVA condition, " +
    "contact, addresses, notes, payment term, category, default expense " +
    "account or cost center) for the user to accept on a card. Pass the " +
    "supplier as the user named it and ONLY the fields to change; an empty " +
    "string clears a text field, 'ninguna'/'ninguno' a category, account or " +
    "center. Writes nothing by itself.",
  input: z.object({
    supplier: lookupInput.describe(
      "Supplier name or CUIT, as the user said it.",
    ),
    legal_name: nameInput.optional(),
    cuit: z.string().trim().max(20).optional(),
    iva_condition: z.enum(IVA_CONDITIONS).optional(),
    ...supplierFieldsInput,
  }),
  spec: supplierUpdateProposalSpec,
  prepare: async (_ctx, input) => {
    const {
      supplier: said,
      payment_term_days,
      category,
      expense_account,
      cost_center,
      ...text
    } = input;
    const lookup = await findSupplier(said, { onlyActive: false });
    if (lookup.kind === "stop") return lookup.result;
    const { supplier } = lookup;
    if (
      !supplier.is_fiscal &&
      (text.cuit !== undefined ||
        text.iva_condition !== undefined ||
        text.address !== undefined)
    ) {
      return {
        kind: "error",
        error:
          "Un proveedor de Otras compras no lleva CUIT, condición de IVA ni domicilio fiscal.",
      };
    }
    const labels: ProposalLabels = {};
    const resolved = await resolveDefaults(
      { category, expense_account, cost_center },
      labels,
    );
    if (resolved.kind === "stop") return resolved.result;

    const patch: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(text).filter(([, v]) => v !== undefined),
      ),
      ...(payment_term_days !== undefined && {
        default_payment_term_days: payment_term_days,
      }),
      ...resolved.defaults,
    };
    // What would really change: a value equal to the stored one is dropped.
    const stored = (field: string): unknown => Reflect.get(supplier, field);
    const changed = Object.entries(patch).filter(([field, value]) => {
      const now = stored(field) ?? null;
      const next = value === "" ? null : value;
      return field === "cuit" && typeof next === "string"
        ? next.replace(/[^0-9]/g, "") !== now
        : next !== now;
    });
    if (changed.length === 0) {
      return {
        kind: "error",
        error: `${supplierName(supplier)} ya tiene esos datos: no hay nada que cambiar.`,
      };
    }
    if (typeof text.cuit === "string") {
      const other = await findSupplierByCuitAction(text.cuit);
      if (!other.ok) return { kind: "error", error: other.error };
      if (other.data && other.data.id !== supplier.id) {
        return {
          kind: "error",
          error: `Ya existe otro proveedor con ese CUIT: ${other.data.legal_name}.`,
        };
      }
    }

    const names = changed.some(([f]) => ID_FIELDS.some((i) => i === f))
      ? await storedNames(supplier)
      : new Map<string, string>();
    labels[SUPPLIER_LABELS.supplier] = supplierName(supplier);
    for (const [field] of changed) {
      labels[SUPPLIER_LABELS.before(field)] = beforeText(
        field,
        stored(field),
        names,
      );
    }
    return {
      kind: "draft",
      draft: { id: supplier.id, ...Object.fromEntries(changed) },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const res = await updateSupplier(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: draft.id } } : res;
  },
});
