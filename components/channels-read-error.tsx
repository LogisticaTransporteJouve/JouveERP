"use client";

import { useRouter } from "next/navigation";

import { useScope } from "@/components/providers/scope-provider";
import { ReadError } from "@/components/read-error";

/** The layout's channel read failed: every channel label, select and
 *  fiscal/internal split below it works from an empty list. Says so instead
 *  of letting them read as "no channels"; «Reintentar» re-renders the
 *  layout, which reads them again. The layout shows it above the page;
 *  `inline` goes under a channel select, since a dialog covers the page's. */
export function ChannelsReadError({
  inline = false,
  className,
}: {
  inline?: boolean;
  className?: string;
}) {
  const { channelsFailed } = useScope();
  const router = useRouter();
  if (!channelsFailed) return null;
  return (
    <ReadError
      className={className}
      message={
        inline
          ? "No se pudieron cargar los canales."
          : "No se pudieron cargar los canales de facturación: los selectores de canal y las etiquetas Fiscal/Interno no están disponibles."
      }
      onRetry={() => router.refresh()}
    />
  );
}
