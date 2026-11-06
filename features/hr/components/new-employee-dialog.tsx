"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { EmployeeForm } from "./employee-form";

export function NewEmployeeDialog({
  canSetVacations,
}: {
  /** Owner/admin: may load vacation days with the employee. */
  canSetVacations: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo empleado
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Nuevo empleado</DialogTitle>
          <DialogDescription>
            Datos personales + de pago. La liquidación detallada la sigue
            haciendo el liquidador externo.
          </DialogDescription>
        </DialogHeader>
        <EmployeeForm
          mode="create"
          canSetVacations={canSetVacations}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
