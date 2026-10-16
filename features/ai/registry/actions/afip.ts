import { z } from "zod";

import { getCaeaStatusAction } from "@/features/afip-admin/actions/afip-admin-actions";
import { getAfipLastNumbersAction } from "@/features/afip-admin/actions/afip-status-actions";

import { defineAiAction } from "../define";
import { errResult, okResult } from "../result";

export const getAfipStatus = defineAiAction({
  name: "getAfipStatus",
  domain: "afip",
  permission: "afip:admin",
  sideEffect: "read",
  sources: ["sales_points", "invoices", "caea_codes"],
  description:
    "Estado AFIP guardado en el sistema (no consulta a AFIP): puntos de venta con último número y fecha por tipo y letra, últimos CAEA y comprobantes CAEA pendientes de informar. Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const [numbers, caea] = await Promise.all([
      getAfipLastNumbersAction(),
      getCaeaStatusAction(),
    ]);
    if (!numbers.ok) return errResult(numbers.error);
    if (!caea.ok) return errResult(caea.error);
    const salesPoints = new Set(numbers.data.map((r) => r.punto_venta)).size;
    return okResult(
      `${salesPoints} puntos de venta con numeración · ${caea.data.codes.length} CAEA recientes · ` +
        `${caea.data.pendingToInform} comprobantes CAEA sin informar.`,
      { lastNumbers: numbers.data, caea: caea.data },
    );
  },
});
