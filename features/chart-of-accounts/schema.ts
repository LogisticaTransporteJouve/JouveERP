import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const CHART_OF_ACCOUNTS_PATH = "/accounting/chart";

export type ChartAccount =
  Database["public"]["Tables"]["chart_of_accounts"]["Row"];

export const COA_ACCOUNT_TYPES = [
  "activo",
  "pasivo",
  "patrimonio",
  "resultado_positivo",
  "resultado_negativo",
  "orden",
] as const;

export type CoaAccountType = (typeof COA_ACCOUNT_TYPES)[number];

export const COA_ACCOUNT_TYPE_LABEL: Record<CoaAccountType, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  resultado_positivo: "Resultado positivo",
  resultado_negativo: "Resultado negativo",
  orden: "Cuenta de orden",
};

export const COA_SYSTEM_ROLES = [
  "caja",
  "banco",
  "clientes",
  "proveedores",
  "iva_debito",
  "iva_credito",
  "iva_percibido",
  "iva_retenido",
  "percepciones_iibb_pagadas",
  "percepciones_iibb_cobradas",
  "retenciones_pagadas",
  "retenciones_cobradas",
  "ventas",
  "compras",
  "gastos",
  "cheques_cartera",
  "cheques_diferidos_emitidos",
  "caja_apertura",
  "ajustes_caja",
] as const;

export type CoaSystemRole = (typeof COA_SYSTEM_ROLES)[number];

export const COA_SYSTEM_ROLE_LABEL: Record<CoaSystemRole, string> = {
  caja: "Caja",
  banco: "Banco",
  clientes: "Clientes",
  proveedores: "Proveedores",
  iva_debito: "IVA Débito Fiscal",
  iva_credito: "IVA Crédito Fiscal",
  iva_percibido: "IVA Percibido",
  iva_retenido: "IVA Retenido",
  percepciones_iibb_pagadas: "Percepciones IIBB pagadas",
  percepciones_iibb_cobradas: "Percepciones IIBB cobradas",
  retenciones_pagadas: "Retenciones pagadas",
  retenciones_cobradas: "Retenciones cobradas",
  ventas: "Ventas",
  compras: "Compras",
  gastos: "Gastos",
  cheques_cartera: "Cheques en cartera",
  cheques_diferidos_emitidos: "Cheques diferidos emitidos",
  caja_apertura: "Apertura de caja",
  ajustes_caja: "Ajustes de caja",
};

const codeRegex = /^[0-9]+(\.[0-9]+)*$/;

const nullableTrimmed = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const ChartAccountCreateSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  code: z
    .string()
    .trim()
    .min(1, "Código requerido.")
    .max(40)
    .regex(codeRegex, "Formato: 1.1.2.3 (números separados por punto)."),
  name: z.string().trim().min(2, "Nombre requerido.").max(80),
  account_type: z.enum(COA_ACCOUNT_TYPES),
  eerr_category: nullableTrimmed,
  system_role: z.enum(COA_SYSTEM_ROLES).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const ChartAccountUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80).optional(),
  account_type: z.enum(COA_ACCOUNT_TYPES).optional(),
  eerr_category: nullableTrimmed,
  system_role: z.enum(COA_SYSTEM_ROLES).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const ChartAccountDeleteSchema = z.object({
  id: z.string().uuid(),
});

export type ChartAccountCreateInput = z.infer<typeof ChartAccountCreateSchema>;
export type ChartAccountUpdateInput = z.infer<typeof ChartAccountUpdateSchema>;

export function levelFromCode(code: string): number {
  return code.split(".").length;
}

export function parentCodeFromCode(code: string): string | null {
  const parts = code.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

export function suggestChildCode(
  parentCode: string,
  siblingCodes: readonly string[],
): string {
  const prefix = `${parentCode}.`;
  let maxSeg = 0;
  for (const sib of siblingCodes) {
    if (!sib.startsWith(prefix)) continue;
    const tail = sib.slice(prefix.length);
    if (tail.includes(".")) continue;
    const n = Number(tail);
    if (Number.isFinite(n) && n > maxSeg) maxSeg = n;
  }
  return `${prefix}${maxSeg + 1}`;
}

export type ChartAccountWithChildren = ChartAccount & {
  children: ChartAccountWithChildren[];
};

export function buildAccountTree(
  rows: readonly ChartAccount[],
): ChartAccountWithChildren[] {
  const byId = new Map<string, ChartAccountWithChildren>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  const roots: ChartAccountWithChildren[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByCode = (a: ChartAccount, b: ChartAccount) =>
    compareCodes(a.code, b.code);
  const recurse = (nodes: ChartAccountWithChildren[]) => {
    nodes.sort(sortByCode);
    for (const n of nodes) recurse(n.children);
  };
  recurse(roots);
  return roots;
}

export function compareCodes(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
