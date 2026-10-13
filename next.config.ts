import type { NextConfig } from "next";

const securityHeaders = [
  // Block MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking protection.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Force HTTPS (1 year, include subdomains).
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // Don't leak the full URL on cross-origin navigation.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Opt out of FLoC / Topics API.
  { key: "Permissions-Policy", value: "interest-cohort=()" },
  // Avoid DNS prefetch leaks.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  experimental: {
    // Barrel packages imported across many files: only the used modules get
    // bundled. (date-fns / recharts are in Next's default list.)
    optimizePackageImports: ["lucide-react", "radix-ui", "ai"],
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    // Legacy Spanish routes → English routes. Kept so bookmarks, browser
    // history, and login `redirectTo` params with old URLs still resolve.
    return [
      { source: "/comprobantes/:path*", destination: "/invoices/:path*", permanent: true },
      { source: "/clientes/:path*", destination: "/clients/:path*", permanent: true },
      { source: "/recibos/:path*", destination: "/receipts/:path*", permanent: true },
      { source: "/cuentas/:path*", destination: "/accounts/:path*", permanent: true },
      { source: "/caja/:path*", destination: "/transactions/:path*", permanent: true },
      { source: "/cheques/:path*", destination: "/checks/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
