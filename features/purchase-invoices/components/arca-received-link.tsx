"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useReceivedVoucherCounts } from "../hooks/use-arca-received";

/** "Recibidos de ARCA", with how many wait to be accepted. */
export function ArcaReceivedLink() {
  const pending = useReceivedVoucherCounts().data?.pending ?? 0;
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/purchases/arca">
        <Inbox className="size-4" />
        Recibidos de ARCA
        {pending > 0 && (
          <Badge variant="secondary" className="ml-1 tabular-nums">
            {pending}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
