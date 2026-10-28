import { redirect } from "next/navigation";

import { ExportButton } from "@/components/export-button";
import { searchClientsAction } from "@/features/clients/actions/clients-actions";
import { ClientsTable } from "@/features/clients/components/clients-table";
import {
  CLIENTS_PAGE_SIZE,
  clientsKeys,
} from "@/features/clients/lib/clients-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialOnlyActive = params.inactive !== "1";

  const filters = { query: initialQuery, onlyActive: initialOnlyActive };
  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: clientsKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          searchClientsAction({
            ...filters,
            offset: pageParam,
            limit: CLIENTS_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo único por CUIT, compartido entre Logística Jouve y DZ
            Instalaciones.
          </p>
        </div>
        <ExportButton resource="clients" />
      </div>
      <Hydrate state={dehydratedState}>
        <ClientsTable
          actorAccess={ctx.access}
          initialQuery={initialQuery}
          initialOnlyActive={initialOnlyActive}
        />
      </Hydrate>
    </div>
  );
}
