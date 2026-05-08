import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { QueryProvider } from "@/components/providers/query-provider";
import { ScopeProvider } from "@/components/providers/scope-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Logística y Transporte Jouve",
  description: "ERP de Logística y Transporte Jouve",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-svh bg-background text-foreground antialiased">
        <ThemeProvider>
          <QueryProvider>
            <ScopeProvider>{children}</ScopeProvider>
          </QueryProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
