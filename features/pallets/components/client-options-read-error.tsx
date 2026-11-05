"use client";

import { useRouter } from "next/navigation";

import { ReadError } from "@/components/read-error";

/** The page's client options could not be read (`clientOptions === null`):
 *  says so under a client picker or filter instead of «Sin clientes.».
 *  «Reintentar» re-renders the page, which reads them again. */
export function ClientOptionsReadError({
  clientOptions,
}: {
  clientOptions: readonly unknown[] | null;
}) {
  const router = useRouter();
  if (clientOptions !== null) return null;
  return (
    <ReadError
      message="No se pudieron cargar los clientes."
      onRetry={() => router.refresh()}
    />
  );
}
