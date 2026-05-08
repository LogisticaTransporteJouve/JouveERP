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
    optimizePackageImports: ["lucide-react"],
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
};

export default nextConfig;
