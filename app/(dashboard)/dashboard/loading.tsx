import { Skeleton } from "@/components/ui/skeleton";

const ACTION_WIDTHS = ["w-20", "w-20", "w-20", "w-40", "w-20", "w-20", "w-28"];

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="h-3 w-16 shrink-0" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="flex flex-wrap gap-2">
        {ACTION_WIDTHS.map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w}`} />
        ))}
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton rows={8} />
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-72" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}
