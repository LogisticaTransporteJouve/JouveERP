import "server-only";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { CLIENT_AGING_PERMISSIONS } from "@/lib/auth/permissions";

import { agingExport, type Exporter } from "../shared";

export const aging: Exporter = {
  permission: CLIENT_AGING_PERMISSIONS,
  // Snapshot: aging buckets reflect "today". The date range is ignored.
  load: async () => {
    const res = await getAgingSummaryAction();
    if (!res.ok) throw new Error(res.error);
    return agingExport(res.data, {
      title: "Aging de clientes",
      subtitle: "Saldos pendientes por antigüedad",
      partyHeader: "Cliente",
      fileName: "aging-clientes",
    });
  },
};
