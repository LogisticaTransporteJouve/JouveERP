import type { GuidePage } from "../types";

import { conceptsPage } from "./conceptos";

/** The guide's chapters, in menu order. Each one renders to
 *  docs/manual/<file> (`pnpm manual:build`). */
export const GUIDE_PAGES: readonly GuidePage[] = [conceptsPage];
