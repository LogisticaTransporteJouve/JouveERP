// Self-test for eslint.fences.mjs, run through the real eslint.config.mjs so a
// config the schema rejects, or a later block that drops a fence, fails here.

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function fenceErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter(
      (m) =>
        m.ruleId === "@typescript-eslint/no-restricted-imports" ||
        m.ruleId === "no-restricted-syntax" ||
        m.ruleId === "no-restricted-globals" ||
        m.ruleId === "no-restricted-properties" ||
        m.fatal === true,
    )
    .map((m) => m.message);
}

const flagged: Array<[string, string, string]> = [
  [
    "AI provider outside model.ts",
    "features/invoices/lib/x.ts",
    'import { anthropic } from "@ai-sdk/anthropic";\nexport const a = anthropic;\n',
  ],
  [
    "Sentry in a feature",
    "features/invoices/lib/x.ts",
    'import * as Sentry from "@sentry/nextjs";\nexport const s = Sentry;\n',
  ],
  [
    "lib importing a feature action",
    "lib/pdf/x.ts",
    'import { listClientsAction } from "@/features/clients/actions/clients-actions";\nexport const f = listClientsAction;\n',
  ],
  [
    "lib importing a nested feature action",
    "lib/pdf/x.ts",
    'import { confirmDocumentAction } from "@/features/ai/document/actions";\nexport const f = confirmDocumentAction;\n',
  ],
  [
    "a write action across features",
    "features/receipts/lib/x.ts",
    'import { createClientAction } from "@/features/clients/actions/clients-actions";\nexport const f = createClientAction;\n',
  ],
  [
    "a getOrCreate write across features",
    "features/receipts/lib/x.ts",
    'import { getOrCreateSelfChannelAction } from "@/features/chat/actions/channels";\nexport const f = getOrCreateSelfChannelAction;\n',
  ],
  [
    "a dynamic import of another feature's actions",
    "features/receipts/lib/x.ts",
    'export const load = () => import("@/features/clients/actions/clients-actions");\n',
  ],
  [
    "the service-role key outside service.ts",
    "lib/pdf/x.ts",
    "export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
  ],
  [
    "resolveAccess in app/",
    "app/(dashboard)/x/page.tsx",
    'import { resolveAccess } from "@/lib/auth/permissions";\nexport const r = resolveAccess;\n',
  ],
  [
    "roleGrants in a non-admin feature",
    "features/invoices/lib/x.ts",
    'import { roleGrants } from "@/lib/auth/permissions";\nexport const r = roleGrants;\n',
  ],
  [
    "a cast to Access",
    "features/invoices/lib/x.ts",
    'import type { Access } from "@/lib/auth/permissions";\nexport const a = {} as Access;\n',
  ],
  [
    "parseFloat on an amount",
    "features/invoices/lib/x.ts",
    'export const n = parseFloat("1.5");\n',
  ],
];

const allowed: Array<[string, string, string]> = [
  [
    "@ai-sdk/react in a component",
    "features/ai/components/x.tsx",
    'import { useChat } from "@ai-sdk/react";\nexport const u = useChat;\n',
  ],
  [
    "a read action across features",
    "features/receipts/lib/x.ts",
    'import { getClientByIdAction } from "@/features/clients/actions/clients-actions";\nexport const f = getClientByIdAction;\n',
  ],
  [
    "issueFiscalInvoiceAction across features",
    "features/shipments/lib/x.ts",
    'import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";\nexport const f = issueFiscalInvoiceAction;\n',
  ],
  [
    "a type import of another feature's actions",
    "features/receipts/lib/x.ts",
    'import type { ClientRow } from "@/features/clients/actions/clients-actions";\nexport type C = ClientRow;\n',
  ],
  [
    "a feature importing its own actions",
    "features/clients/lib/x.ts",
    'import { createClientAction } from "@/features/clients/actions/clients-actions";\nexport const f = createClientAction;\n',
  ],
  [
    "a test importing another feature's actions dynamically",
    "features/ai/document/x.test.ts",
    'export const load = () => import("@/features/invoices/actions/invoices-actions");\n',
  ],
  [
    "the service-role key in service.ts",
    "lib/supabase/service.ts",
    "export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
  ],
  [
    "resolveAccess in lib/auth/context.ts",
    "lib/auth/context.ts",
    'import { resolveAccess } from "@/lib/auth/permissions";\nexport const r = resolveAccess;\n',
  ],
  [
    "roleGrants in the access UI",
    "features/admin-users/components/x.tsx",
    'import { roleGrants } from "@/lib/auth/permissions";\nexport const r = roleGrants;\n',
  ],
  [
    "parseFloat in lib/format.ts",
    "lib/format.ts",
    'export const n = parseFloat("1.5");\n',
  ],
];

describe("eslint fences", () => {
  it.each(flagged)("flags %s", async (_name, filePath, code) => {
    expect(await fenceErrors(filePath, code)).not.toEqual([]);
  });

  it.each(allowed)("allows %s", async (_name, filePath, code) => {
    expect(await fenceErrors(filePath, code)).toEqual([]);
  });
});
