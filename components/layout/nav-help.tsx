import { LifeBuoy } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { MANUAL_WINDOW } from "@/lib/manual/windows";

/** The user guide (docs/manual/, served at /manual), in its own named tab
 *  that every help link reuses: it is static HTML, not a Next page. */
export function NavHelp(
  props: React.ComponentPropsWithoutRef<typeof SidebarGroup>,
) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm" className="text-xs">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /manual is a route handler serving static HTML, not a page */}
              <a href="/manual" target={MANUAL_WINDOW}>
                <LifeBuoy />
                <span>Guía de uso</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
