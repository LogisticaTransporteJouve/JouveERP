// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import type { InvoicingChannelSummary, ScopeSide } from "@/lib/scope";

const h = vi.hoisted(() => ({
  pathname: "/dashboard",
  refresh: vi.fn(),
  setOpenMobile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChatUnreadCountLite: () => 0,
}));
vi.mock("./nav-user", () => ({ NavUser: () => null }));
vi.mock("./nav-theme", () => ({ NavTheme: () => null }));
vi.mock("@/components/ui/sidebar", async () => {
  const { Slot } = await import("@radix-ui/react-slot");
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const AsChild = ({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children?: React.ReactNode;
  }) => (asChild ? <Slot>{children}</Slot> : <div>{children}</div>);
  return {
    Sidebar: Pass,
    SidebarContent: Pass,
    SidebarFooter: Pass,
    SidebarGroup: Pass,
    SidebarGroupContent: Pass,
    SidebarHeader: Pass,
    SidebarMenu: Pass,
    SidebarMenuItem: Pass,
    SidebarGroupLabel: AsChild,
    SidebarMenuButton: AsChild,
    useSidebar: () => ({ setOpenMobile: h.setOpenMobile }),
  };
});

const { ScopeProvider, useScope } =
  await import("@/components/providers/scope-provider");
const { AppSidebar } = await import("./app-sidebar");

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Interno", is_fiscal: false, is_active: true },
];

function Observe() {
  return <span data-testid="side">{useScope().fiscalFilter}</span>;
}

function side(): string | null {
  return screen.getByTestId("side").textContent;
}

function renderSidebar(initial: ScopeSide = "fiscal") {
  render(
    <ScopeProvider channels={CHANNELS} initialFiscalFilter={initial}>
      <Observe />
      <AppSidebar
        userEmail="a@b.c"
        userAccess={resolveAccess(["owner"])}
        profile={{
          firstName: null,
          lastName: null,
          avatarUrl: null,
          avatarColor: "#000",
        }}
      />
    </ScopeProvider>,
  );
  // Open the "Otras ventas" section to reach its items.
  fireEvent.click(screen.getByText("Otras ventas"));
}

function otrasVentasComprobantes(): HTMLElement {
  const links = screen
    .getAllByRole("link")
    .filter((a) => a.getAttribute("href") === "/invoices");
  // Ventas and Otras ventas both list /invoices; on /dashboard only the
  // section opened above is expanded, so the one link is Otras ventas'.
  expect(links).toHaveLength(1);
  return links[0]!;
}

beforeEach(() => {
  h.pathname = "/dashboard";
  h.refresh.mockClear();
  h.setOpenMobile.mockClear();
});
afterEach(cleanup);

describe("NavLink side switch", () => {
  it("a plain click to another page switches the side inside the navigation's transition", () => {
    renderSidebar("fiscal");
    fireEvent.click(otrasVentasComprobantes(), { button: 0 });
    expect(side()).toBe("internal");
    // Superseded by the navigation; it only drops the router's cached pages.
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it("a plain click on the same page under the other side refreshes it", () => {
    h.pathname = "/invoices";
    renderSidebar("fiscal");
    // On /invoices the active Ventas section is open too: the last
    // /invoices link is Otras ventas'.
    const links = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "/invoices");
    fireEvent.click(links[links.length - 1]!, { button: 0 });
    expect(side()).toBe("internal");
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cmd", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["middle button", { button: 1 }],
  ])("a %s-click (new tab/window) leaves this tab's side alone", (_, init) => {
    renderSidebar("fiscal");
    fireEvent.click(otrasVentasComprobantes(), { button: 0, ...init });
    expect(side()).toBe("fiscal");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.setOpenMobile).not.toHaveBeenCalled();
  });

  it("a click on an item of the current side does not refresh", () => {
    renderSidebar("internal");
    fireEvent.click(otrasVentasComprobantes(), { button: 0 });
    expect(side()).toBe("internal");
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
