export default function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">JouveERP</h1>
      <p className="text-sm text-muted-foreground">
        Scaffold inicial. La Fase A.2 trae tooling (Vitest, ESLint flat, CI),
        después llegan login y dashboard.
      </p>
    </main>
  );
}
