"use client";

import { Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useCanCreateSupplierCategory,
  useCreateSupplierCategory,
  useSupplierCategoriesList,
} from "../hooks/use-supplier-categories";
import { SupplierCategoryNameSchema } from "../schema";

const NONE = "__none";
const NEW = "__new";

/**
 * Supplier category picker (`value` is the id, "" for none). A user who may
 * create categories gets "Nueva categoría" at the bottom: a nested dialog
 * creates one and selects it, leaving the surrounding form as it was.
 *
 * `id` and the aria props come from `FormControl`, so the trigger is the
 * element its `FormLabel` names.
 */
export function SupplierCategorySelect({
  value,
  onChange,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const categoriesQuery = useSupplierCategoriesList({ onlyActive: true });
  const categories = categoriesQuery.data ?? [];
  const canCreate = useCanCreateSupplierCategory();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Select
        value={value || NONE}
        onValueChange={(v) => {
          if (v === NEW) setCreating(true);
          else onChange(v === NONE ? "" : v);
        }}
      >
        <SelectTrigger
          className="w-full min-w-0"
          id={id}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
        >
          <SelectValue placeholder="Sin categoría" />
        </SelectTrigger>
        <SelectContent position="popper" side="bottom" align="start">
          <SelectItem value={NONE}>Sin categoría</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              {cat.name}
            </SelectItem>
          ))}
          {canCreate && (
            <>
              <SelectSeparator />
              <SelectItem value={NEW}>
                <Plus />
                Nueva categoría
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      {canCreate && (
        <NewCategoryDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={onChange}
        />
      )}
    </>
  );
}

function NewCategoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const createMut = useCreateSupplierCategory();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (createMut.isPending) return;
    if (!next) {
      setName("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // React bubbles the submit through the portal to the supplier form.
    e.stopPropagation();
    const parsed = SupplierCategoryNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nombre inválido.");
      return;
    }
    try {
      const { id } = await createMut.mutateAsync({ name: parsed.data });
      onCreated(id);
      setName("");
      setError(null);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo crear la categoría.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nueva categoría</DialogTitle>
          <DialogDescription>
            Se agrega a la lista y queda elegida para este proveedor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>Nombre</Label>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Ej: Peajes"
              autoComplete="off"
              maxLength={60}
              autoFocus
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => close(false)}
              disabled={createMut.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
