import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listHubUploadersAction } from "@/features/files/actions/hub-actions";
import { FilesHub } from "@/features/files/components/files-hub";
import { hubFilesQuery } from "@/features/files/hooks/use-files-hub";
import { filesKeys } from "@/features/files/lib/files-keys";
import { hubScope } from "@/features/files/lib/hub";
import { HubFiltersSchema, type HubFilters } from "@/features/files/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const parsed = HubFiltersSchema.safeParse({
    search: params.q || null,
    entityType: params.origen || null,
    fileKind: params.tipo || null,
    uploadedBy: params.por || null,
    dateFrom: params.desde || null,
    dateTo: params.hasta || null,
  });
  const filters: HubFilters = parsed.success ? parsed.data : {};
  const { entityTypes } = hubScope(ctx.roles);

  const dehydratedState = await prefetchQueries([
    { infinite: true, ...hubFilesQuery(filters) },
    {
      queryKey: filesKeys.hubUploaders(),
      queryFn: () => runAction(() => listHubUploadersAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Archivos</h1>
        <p className="text-muted-foreground text-sm">
          Todos los archivos que podés ver: adjuntos de comprobantes, documentos
          escaneados, documentos de empleados y adjuntos de tus chats con la IA.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <FilesHub entityTypes={entityTypes} initialFilters={filters} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
