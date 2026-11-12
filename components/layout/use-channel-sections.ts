"use client";

import { useMemo } from "react";

import { useScope } from "@/components/providers/scope-provider";
import { isMainChannel } from "@/lib/scope";

import { channelSections, type NavSection } from "./nav-items";

/** The menu sections of the active segregated channels (fiscal ones only for
 *  a fiscal-only user), one stable list per channel set, so the sidebar and
 *  the header compare the same item objects. */
export function useChannelSections(): NavSection[] {
  const { allChannels, locked } = useScope();
  return useMemo(
    () =>
      channelSections(
        allChannels.filter(
          (c) => c.is_active && !isMainChannel(c) && (!locked || c.is_fiscal),
        ),
      ),
    [allChannels, locked],
  );
}
