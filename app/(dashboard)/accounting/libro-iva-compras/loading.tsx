import { Skeleton } from "@/components/ui/skeleton";

export default function LibroIvaComprasLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-[240px]" />
        <Skeleton className="h-4 w-[420px]" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
