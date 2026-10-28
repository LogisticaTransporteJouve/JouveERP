// Import fences: the layer map in .agents/skills/enforce-ports-and-adapters
// encoded as lint rules, so `pnpm lint` enforces what review used to.
//
// Each block covers a disjoint set of files and restates every fence it keeps:
// in flat config a later block REPLACES a rule's options for the files it
// matches, so a block that listed only its own fence would drop the others.
// `@typescript-eslint/no-restricted-imports` does not see `import()` or
// `require()`, so the same specifiers are also banned through
// `no-restricted-syntax`, which has no name allow-list: a dynamic import of
// another feature's actions is banned whatever it imports.
//
// Self-test: scripts/eslint-fences.test.ts (runs in `pnpm test`).

import { readdirSync } from "node:fs";

const SRC = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
const TESTS = ["**/*.test.{ts,tsx}", "tests/**"];
const TOOLING = ["scripts/**", ".github/**"];

const AI_PROVIDERS = {
  regex: "^@ai-sdk/(?!react(/|$))",
  message: "AI providers are built only in features/ai/model.ts.",
};
const INNGEST_AI = {
  regex: "^@inngest/(ai|agent-kit)([/?#]|$)",
  message: "Models go through features/ai/model.ts, not Inngest's AI helpers.",
};
const SENTRY = {
  regex: "^@sentry/",
  message:
    "Report errors through lib/observability.ts; Sentry is set up only in sentry.*.config.ts and instrumentation.ts.",
};
const LIB_TO_FEATURE = {
  regex: "^@/features/.+/(actions|components|hooks)(\\.[jt]sx?)?(/|$)",
  message:
    "lib/ is base: it must not import a feature's actions, components or hooks. Inject it or move the logic to lib/.",
};
// Read actions feeding a picker or hook may cross features (CLAUDE.md), and
// issueFiscalInvoiceAction is the documented write exception.
const CROSS_FEATURE_ALLOWED_NAMES =
  "^(issueFiscalInvoiceAction$|(?!getOrCreate)(list|get|search|lookup|find)[A-Z])";
const crossFeatureActions = (feature) => ({
  regex: `^@/features/(?!${feature}/).+/actions(\\.[jt]sx?)?(/|$)`,
  message:
    "Business-logic actions do not cross features (CLAUDE.md): only read actions (list/get/search/lookup/find…) and issueFiscalInvoiceAction. Move shared logic to @/lib/.",
});

const PERMISSIONS_MODULE = "^@/lib/auth/permissions$";
const RESOLVE_ACCESS = {
  regex: PERMISSIONS_MODULE,
  importNames: ["resolveAccess"],
  message:
    "Access is built only in lib/auth (context, headless-user, users), so every gate sees the user's denies.",
};
const ROLE_LEVEL = {
  regex: PERMISSIONS_MODULE,
  importNames: [
    "roleGrants",
    "rolePermissions",
    "effectivePermissions",
    "ROLE_PERMISSIONS",
  ],
  message:
    "Role-level helpers ignore per-user denies: gates use userCan(ctx.access, …). Only lib/auth and the access UI read them.",
};

const SERVICE_KEY = "/^(NEXT_PUBLIC_)?SUPABASE_SERVICE_ROLE_KEY$/";
const SERVICE_KEY_READS = [
  `Identifier[name=${SERVICE_KEY}]`,
  `Literal[value=${SERVICE_KEY}]`,
  `TemplateElement[value.cooked=${SERVICE_KEY}]`,
].map((selector) => ({
  selector,
  message: "Only lib/supabase/service.ts reads SUPABASE_SERVICE_ROLE_KEY.",
}));

const ACCESS_CASTS = [
  'TSAsExpression[typeAnnotation.typeName.name="Access"]',
  'TSSatisfiesExpression[typeAnnotation.typeName.name="Access"]',
  'TSTypeAssertion[typeAnnotation.typeName.name="Access"]',
].map((selector) => ({
  selector,
  message: "Build Access with resolveAccess (lib/auth), never by a cast.",
}));

// The fences read import specifiers, so a computed one cannot pass them.
const LITERAL_IMPORTS_ONLY = [
  'ImportExpression[source.type!="Literal"]',
  'CallExpression[callee.name="require"][arguments.0.type!="Literal"]',
  'ImportSpecifier[imported.name="createRequire"]',
].map((selector) => ({
  selector,
  message: "Import a module by a string literal so the import fences see it.",
}));

const asSelector = (regex) => `/${regex.replaceAll("/", "\\/")}/`;

/**
 * The two rules for one block. `modules` are banned specifiers; an entry with
 * `importNames` bans only those names from the module, and one with
 * `allowImportNamePattern` bans every name that does not match it.
 */
function fence(modules, syntax = []) {
  const whole = modules.filter((m) => !m.importNames);
  return {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: modules.map(
          ({ regex, message, importNames, allowImportNamePattern }) => ({
            regex,
            message,
            allowTypeImports: true,
            ...(importNames ? { importNames } : {}),
            ...(allowImportNamePattern ? { allowImportNamePattern } : {}),
          }),
        ),
      },
    ],
    "no-restricted-syntax": [
      "error",
      ...whole.flatMap(({ regex, message }) => [
        {
          selector: `ImportExpression[source.value=${asSelector(regex)}]`,
          message,
        },
        {
          selector: `CallExpression[callee.name="require"][arguments.0.value=${asSelector(regex)}]`,
          message,
        },
      ]),
      ...LITERAL_IMPORTS_ONLY,
      ...syntax,
    ],
  };
}

const BASE = [AI_PROVIDERS, INNGEST_AI, SENTRY];
const ACCESS = [RESOLVE_ACCESS, ROLE_LEVEL];
const DEFAULT_SYNTAX = [...SERVICE_KEY_READS, ...ACCESS_CASTS];

const MODEL = "features/ai/model.ts";
const SENTRY_SEAM = [
  "sentry.*.config.ts",
  "instrumentation.ts",
  "lib/observability.ts",
];
const SERVICE_CLIENT = "lib/supabase/service.ts";
const AUTH_BUILDERS = [
  "lib/auth/context.ts",
  "lib/auth/headless-user.ts",
  "lib/auth/users.ts",
];
const PERMISSIONS_FILE = "lib/auth/permissions.ts";
const ACCESS_UI = [
  "features/admin-users/components/**",
  "features/admin-users/lib/**",
];
// Files that write another feature's action today; each is a Follow-up and
// this list only shrinks.
const CROSS_FEATURE_DEBT = [
  "features/loans/actions/loans-actions.ts",
  "features/ai/document/actions.ts",
];

const SEAMS = [
  MODEL,
  ...SENTRY_SEAM,
  SERVICE_CLIENT,
  ...AUTH_BUILDERS,
  PERMISSIONS_FILE,
];
const SPECIAL = [...SEAMS, ...TESTS, ...TOOLING, ...CROSS_FEATURE_DEBT];

const features = readdirSync(new URL("./features", import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const crossFeature = (feature) => ({
  ...crossFeatureActions(feature),
  allowImportNamePattern: CROSS_FEATURE_ALLOWED_NAMES,
});

export const fenceBlocks = [
  {
    files: [`**/*.${SRC}`],
    ignores: [...SPECIAL, "lib/**", "features/**"],
    rules: fence([...BASE, ...ACCESS], DEFAULT_SYNTAX),
  },
  {
    files: [`lib/**/*.${SRC}`],
    ignores: SPECIAL,
    rules: fence(
      [
        ...BASE,
        LIB_TO_FEATURE,
        .../* lib/auth may use role-level helpers */ [RESOLVE_ACCESS],
      ],
      DEFAULT_SYNTAX,
    ),
  },
  ...features.map((feature) => ({
    files: [`features/${feature}/**/*.${SRC}`],
    ignores: [...SPECIAL, ...(feature === "admin-users" ? ACCESS_UI : [])],
    rules: fence([...BASE, ...ACCESS, crossFeature(feature)], DEFAULT_SYNTAX),
  })),
  {
    files: ACCESS_UI,
    ignores: SPECIAL,
    rules: fence([...BASE, crossFeature("admin-users")], DEFAULT_SYNTAX),
  },
  {
    files: CROSS_FEATURE_DEBT,
    rules: fence([...BASE, ...ACCESS], DEFAULT_SYNTAX),
  },
  {
    files: [MODEL],
    rules: fence([INNGEST_AI, SENTRY, ...ACCESS], DEFAULT_SYNTAX),
  },
  {
    files: SENTRY_SEAM,
    rules: fence([AI_PROVIDERS, INNGEST_AI, ...ACCESS], DEFAULT_SYNTAX),
  },
  {
    files: [SERVICE_CLIENT],
    rules: fence([...BASE, ...ACCESS], ACCESS_CASTS),
  },
  {
    files: AUTH_BUILDERS,
    rules: fence([...BASE, LIB_TO_FEATURE], DEFAULT_SYNTAX),
  },
  {
    files: [PERMISSIONS_FILE],
    rules: fence([...BASE, LIB_TO_FEATURE], SERVICE_KEY_READS),
  },
  // Tests may build Access, read the key and import any feature's actions.
  { files: TESTS, rules: fence(BASE) },
  { files: TOOLING, rules: { "no-restricted-syntax": "off" } },
];

// Money is a number parsed in one place.
const PARSE_MESSAGE =
  "Parse amounts with the helpers in lib/format.ts / lib/validation/common.ts.";
export const moneyBlocks = [
  {
    files: [`**/*.${SRC}`],
    ignores: ["lib/format.ts", "lib/validation/common.ts", ...TOOLING],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: PARSE_MESSAGE },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: PARSE_MESSAGE },
        {
          object: "globalThis",
          property: "parseFloat",
          message: PARSE_MESSAGE,
        },
      ],
    },
  },
];
