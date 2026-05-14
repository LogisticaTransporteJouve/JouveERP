import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarBgClass, getInitials } from "@/lib/avatars";
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<Size, string> = {
  xs: "size-5 text-[8px]",
  sm: "size-7 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-16 text-lg",
};

type Props = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  color?: string | null;
  size?: Size;
  className?: string;
  ring?: boolean;
};

export function UserAvatar({
  firstName,
  lastName,
  email,
  avatarUrl,
  color,
  size = "md",
  className,
  ring,
}: Props) {
  return (
    <Avatar
      className={cn(
        SIZE_CLASSES[size],
        ring && "ring-2 ring-background",
        className,
      )}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        className={cn(getAvatarBgClass(color), "font-medium")}
      >
        {getInitials(firstName, lastName, email)}
      </AvatarFallback>
    </Avatar>
  );
}
