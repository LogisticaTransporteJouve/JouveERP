import { Skeleton } from "@/components/ui/skeleton";

// Generic fallback used by the (dashboard) segment Suspense boundary.
// Per-route loading.tsx files override this with skeletons that match the
// final layout — preferred for polished pages.
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-[220px]" />
        <Skeleton className="h-4 w-[320px]" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-4 w-[80%]" />
          <Skeleton className="h-4 w-[85%]" />
        </div>
      </div>
    </div>
  );
}
