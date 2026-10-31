import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid h-[calc(100vh-3.5rem-4rem)] grid-cols-[260px_1fr] overflow-hidden rounded-lg border bg-card">
      <aside className="space-y-2 border-r p-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </aside>
      <section className="flex flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Cargando mensajes…
        </div>
      </section>
    </div>
  );
}
