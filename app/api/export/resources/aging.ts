import "server-only";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { CLIENT_AGING_PERMISSIONS } from "@/lib/auth/permissions";

import {
  agingExport,
  exportScope,
  scopedSubtitle,
  type Exporter,
} from "../shared";

export const aging: Exporter = {
  permission: CLIENT_AGING_PERMISSIONS,
  // Snapshot: aging buckets reflect "today". The date range is ignored.
  load: async (params) => {
    const { scope, isFiscal } = exportScope(params);
    const res = await getAgingSummaryAction({ isFiscal });
    if (!res.ok) throw new Error(res.error);
    return agingExport(res.data, {
      title: "Aging de clientes",
      subtitle: scopedSubtitle(scope, "Saldos pendientes por antigüedad"),
      partyHeader: "Cliente",
      fileName: "aging-clientes",
    });
  },
};
