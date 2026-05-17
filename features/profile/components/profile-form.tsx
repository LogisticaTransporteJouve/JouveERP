"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_COLORS, getAvatarBgClass, type AvatarColor } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import {
  useMyProfile,
  useRemoveAvatar,
  useUpdateProfile,
  useUploadAvatar,
} from "../hooks/use-profile";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 1024 * 1024;

const FormSchema = z.object({
  firstName: z.string().trim().max(80, "Máx 80 caracteres."),
  lastName: z.string().trim().max(80, "Máx 80 caracteres."),
  color: z.enum(AVATAR_COLORS),
});

type FormValues = z.infer<typeof FormSchema>;

export function ProfileForm() {
  const { data: profile } = useMyProfile();
  const updateMutation = useUpdateProfile();
  const uploadMutation = useUploadAvatar();
  const removeMutation = useRemoveAvatar();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      firstName: profile.firstName ?? "",
      lastName: profile.lastName ?? "",
      color: (AVATAR_COLORS.includes(profile.avatarColor as AvatarColor)
        ? profile.avatarColor
        : "gray") as AvatarColor,
    },
  });

  const firstName = form.watch("firstName");
  const lastName = form.watch("lastName");
  const color = form.watch("color");

  async function onSubmit(values: FormValues) {
    try {
      await updateMutation.mutateAsync(values);
      toast.success("Perfil actualizado.");
      form.reset(values);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar.");
    }
  }

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) {
      toast.error("Solo PNG, JPG o WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Máx 1 MB.");
      return;
    }
    try {
      await uploadMutation.mutateAsync(file);
      toast.success("Foto actualizada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir.");
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      await removeMutation.mutateAsync();
      toast.success("Foto eliminada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar.");
    }
  };

  const isSaving = updateMutation.isPending;
  const isUploading = uploadMutation.isPending;
  const isRemoving = removeMutation.isPending;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-8 max-w-2xl"
      >
        <section className="flex items-center gap-6">
          <UserAvatar
            firstName={firstName || profile.firstName}
            lastName={lastName || profile.lastName}
            email={profile.email}
            avatarUrl={profile.avatarUrl}
            color={color}
            size="xl"
          />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              PNG, JPG o WebP. Máximo 1 MB.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? "Subiendo…" : "Cambiar foto"}
              </Button>
              {profile.avatarUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isRemoving}
                  onClick={handleRemoveAvatar}
                >
                  {isRemoving ? "Eliminando…" : "Quitar"}
                </Button>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel htmlFor="first-name">Nombre</FormLabel>
                  <FormControl>
                    <Input
                      id="first-name"
                      autoComplete="given-name"
                      maxLength={80}
                      placeholder="Tomás"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel htmlFor="last-name">Apellido</FormLabel>
                  <FormControl>
                    <Input
                      id="last-name"
                      autoComplete="family-name"
                      maxLength={80}
                      placeholder="Dziurdzia"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <Label>Color del avatar</Label>
                <p className="text-xs text-muted-foreground">
                  Se muestra cuando no tenés foto cargada o mientras carga.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        "size-8 rounded-full transition-all",
                        getAvatarBgClass(c),
                        field.value === c
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                          : "hover:ring-2 hover:ring-foreground/30 hover:ring-offset-2 hover:ring-offset-background",
                      )}
                    />
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSaving || !form.formState.isDirty}
          >
            {isSaving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
