import { forwardRef } from "react";

// Sidebar links route through the mock: Mock.shell(href) calls the app's `nav` action.
const Link = forwardRef<HTMLAnchorElement, any>(({ href, prefetch, replace, scroll, onClick, ...p }, ref) => {
  const to = typeof href === "string" ? href : href?.pathname ?? "";
  return (
    <a ref={ref} href="#" data-href={to} {...p} onClick={(e) => {
      e.preventDefault();
      onClick?.(e);
      (window as any).Mock?.shell?.(to);
    }} />
  );
});
export default Link;
