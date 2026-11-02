import { redirect } from "next/navigation";

import { ExportTxtButton } from "@/features/libro-iva/components/export-txt-button";
import { LibroIvaExportButtons } from "@/features/libro-iva/components/libro-iva-export-buttons";
import { getMonthlyPackageStatusAction } from "@/features/monthly-package/actions/monthly-package-actions";
import {
  DownloadRow,
  MonthlyPackageView,
} from "@/features/monthly-package/components/monthly-package-view";
import { monthlyPackageKeys } from "@/features/monthly-package/lib/monthly-package-keys";
import { MonthlyPackagePeriodSchema } from "@/features/monthly-package/schema";
import { periodOf, previousPeriod } from "@/lib/accounting-period";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function MonthlyPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  // The month handed over is usually the one that just ended.
  const requested = MonthlyPackagePeriodSchema.safeParse(
    (await searchParams).period,
  );
  const period = requested.success
    ? requested.data
    : previousPeriod(periodOf(todayInAR()));

  const dehydratedState = await prefetchQueries([
    {
      queryKey: monthlyPackageKeys.status(period),
      queryFn: () => runAction(() => getMonthlyPackageStatusAction(period)),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <MonthlyPackageView
        period={period}
        ivaDownloads={
          <>
            <DownloadRow
              title="Libro IVA Ventas"
              description="PDF y Excel del libro, y los TXT de Libro IVA Digital (comprobantes y alícuotas)."
            >
              <LibroIvaExportButtons
                book="ventas"
                period={period}
                channelId={null}
              />
              <ExportTxtButton book="ventas" period={period} />
            </DownloadRow>
            <DownloadRow
              title="Libro IVA Compras"
              description="PDF y Excel del libro, y los TXT de Libro IVA Digital (comprobantes y alícuotas)."
            >
              <LibroIvaExportButtons
                book="compras"
                period={period}
                channelId={null}
              />
              <ExportTxtButton book="compras" period={period} />
            </DownloadRow>
          </>
        }
      />
    </Hydrate>
  );
}
