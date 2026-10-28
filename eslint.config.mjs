import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { fenceBlocks, moneyBlocks } from "./eslint.fences.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Next 16 / React 19 rules that conflict with shadcn primitives.
      // The rest of react-hooks (deps, exhaustive-deps, rules-of-hooks) stays on.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // Hard ban on implicit `any`.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  ...fenceBlocks,
  ...moneyBlocks,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
