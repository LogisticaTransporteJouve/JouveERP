import { Skeleton } from "@/components/ui/skeleton";

export default function CuentaLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
