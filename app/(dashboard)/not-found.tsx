import { SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// Rendered for every notFound() under (dashboard): a detail page whose record
// was deleted or never existed (e.g. /employees/<id> after the employee was
// removed).
export default function DashboardNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-full bg-muted p-4">
        <SearchX className="size-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">No encontramos lo que buscás</h2>
        <p className="text-sm text-muted-foreground">
          Puede que se haya eliminado o que el enlace esté mal.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Ir al inicio</Link>
      </Button>
    </div>
  );
}
