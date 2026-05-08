import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

type SearchParams = Promise<{ redirectTo?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { redirectTo } = await searchParams;
  const safeRedirect = redirectTo?.startsWith("/") ? redirectTo : undefined;

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-3 text-center">
          <Image
            src="/jouve-logo.jpeg"
            alt="Logística y Transporte Jouve"
            width={48}
            height={48}
            priority
            className="size-12 rounded-md"
          />
          <CardTitle className="text-lg">
            Logística y Transporte Jouve
          </CardTitle>
          <p className="text-sm text-muted-foreground">Ingresá para continuar</p>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={safeRedirect} />
        </CardContent>
      </Card>
    </main>
  );
}
