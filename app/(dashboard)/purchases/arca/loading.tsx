import { Skeleton } from "@/components/ui/skeleton";

export default function ArcaReceivedLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-9 w-80" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
