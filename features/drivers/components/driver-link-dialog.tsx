"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useLinkDriverUser } from "../hooks/use-drivers";
import type { Driver } from "../schema";

const NONE = "__none__";

export type LinkableUser = { id: string; email: string };

export function DriverLinkDialog({
  driver,
  users,
  open,
  onOpenChange,
}: {
  driver: Driver;
  users: LinkableUser[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [userId, setUserId] = useState(driver.user_id ?? NONE);
  const link = useLinkDriverUser();

  function handleSave() {
    link.mutate(
      { driverId: driver.id, userId: userId === NONE ? null : userId },
      {
        onSuccess: () => {
          toast.success("Vínculo actualizado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular usuario a {driver.full_name}</DialogTitle>
          <DialogDescription>
            El usuario vinculado verá solo los viajes asignados a este chofer.
            Un login mapea a un solo chofer.
          </DialogDescription>
        </DialogHeader>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger>
            <SelectValue placeholder="Usuario" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Ninguno (desvincular)</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={link.isPending} onClick={handleSave}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
