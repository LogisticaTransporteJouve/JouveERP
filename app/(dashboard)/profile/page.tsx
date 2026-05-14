import { getMyProfileAction } from "@/features/profile/actions/get-my-profile";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { profileKeys } from "@/features/profile/keys";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const dehydratedState = await prefetchQueries([
    {
      queryKey: profileKeys.me(),
      queryFn: () => runAction(() => getMyProfileAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">
          Cómo te ven el resto de los empleados en el chat, audit y listados.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <ProfileForm />
      </Hydrate>
    </div>
  );
}
