import { Skeleton } from "@/components/ui/skeleton";

export default function ArcaReconciliationLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
