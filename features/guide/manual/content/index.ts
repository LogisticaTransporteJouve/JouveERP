import type { GuidePage } from "../types";

import { conceptsPage } from "./conceptos";
import { platformPage } from "./plataforma";
import { assistantPage } from "./asistente";
import { salesPage } from "./ventas";
import { purchasesPage } from "./compras";
import { adminPage } from "./admin";

/** The guide's chapters, in menu order. Each one renders to
 *  docs/manual/<file> (`pnpm manual:build`). */
export const GUIDE_PAGES: readonly GuidePage[] = [
  conceptsPage,
  platformPage,
  assistantPage,
  salesPage,
  purchasesPage,
  adminPage,
];
