import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid h-[calc(100vh-3.5rem-4rem)] grid-cols-[260px_1fr] overflow-hidden rounded-lg border bg-card">
      <aside className="space-y-2 border-r p-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </aside>
      <section className="flex items-center justify-center text-sm text-muted-foreground">
        Cargando chat…
      </section>
    </div>
  );
}
