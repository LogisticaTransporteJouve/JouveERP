"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

export function ProfileForm() {
  const { data: profile } = useMyProfile();
  const updateMutation = useUpdateProfile();
  const uploadMutation = useUploadAvatar();
  const removeMutation = useRemoveAvatar();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(profile.firstName ?? "");
  const [lastName, setLastName] = useState(profile.lastName ?? "");
  const [color, setColor] = useState<AvatarColor>(
    (AVATAR_COLORS.includes(profile.avatarColor as AvatarColor)
      ? profile.avatarColor
      : "gray") as AvatarColor,
  );

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        firstName,
        lastName,
        color,
      });
      toast.success("Perfil actualizado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar.");
    }
  };

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
    <div className="space-y-8 max-w-2xl">
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
          <div className="space-y-2">
            <Label htmlFor="first-name">Nombre</Label>
            <Input
              id="first-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={80}
              placeholder="Tomás"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Apellido</Label>
            <Input
              id="last-name"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={80}
              placeholder="Dziurdzia"
            />
          </div>
        </div>

        <div className="space-y-2">
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
                onClick={() => setColor(c)}
                className={cn(
                  "size-8 rounded-full transition-all",
                  getAvatarBgClass(c),
                  color === c
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                    : "hover:ring-2 hover:ring-foreground/30 hover:ring-offset-2 hover:ring-offset-background",
                )}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
