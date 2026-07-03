"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Pencil,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  resetMyDashboardLayoutAction,
  saveMyDashboardLayoutAction,
} from "../actions/dashboard-actions";
import {
  WIDGET_IDS,
  WIDGET_LABEL,
  type DashboardLayout,
  type WidgetId,
} from "../schema";

export function DashboardCanvas({
  initialLayout,
  defaultLayout,
  widgets,
}: {
  initialLayout: DashboardLayout;
  defaultLayout: DashboardLayout;
  widgets: Partial<Record<WidgetId, ReactNode>>;
}) {
  const [layout, setLayout] = useState(initialLayout);
  const [savedLayout, setSavedLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const availableIds = WIDGET_IDS.filter((id) => widgets[id] != null);
  const hiddenIds = availableIds.filter(
    (id) => !layout.some((item) => item.id === id),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayout((current) => {
      const from = current.findIndex((i) => i.id === active.id);
      const to = current.findIndex((i) => i.id === over.id);
      if (from < 0 || to < 0) return current;
      return arrayMove(current, from, to);
    });
  }

  function toggleSize(id: WidgetId) {
    setLayout((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, size: item.size === "full" ? "half" : "full" }
          : item,
      ),
    );
  }

  function removeWidget(id: WidgetId) {
    setLayout((current) => current.filter((item) => item.id !== id));
  }

  function addWidget(id: WidgetId) {
    if (layout.some((item) => item.id === id)) return;
    setLayout((current) => [...current, { id, size: "full" }]);
  }

  // Touch fallback: below md the drag handle is hidden and reordering happens
  // with these arrows instead (dnd-kit pointer drag fights page scroll).
  function moveWidget(id: WidgetId, delta: -1 | 1) {
    setLayout((current) => {
      const from = current.findIndex((i) => i.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      return arrayMove(current, from, to);
    });
  }

  async function handleSave() {
    setPending(true);
    const res = await saveMyDashboardLayoutAction(layout);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSavedLayout(layout);
    setEditing(false);
    toast.success("Dashboard guardado.");
  }

  async function handleReset() {
    setPending(true);
    const res = await resetMyDashboardLayoutAction();
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setLayout(defaultLayout);
    setSavedLayout(defaultLayout);
    setEditing(false);
    toast.success("Dashboard restablecido al layout de tu rol.");
  }

  function handleCancel() {
    setLayout(savedLayout);
    setEditing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <p className="text-xs text-muted-foreground">
              <span className="max-md:hidden">
                Arrastrá para reordenar; cambiá tamaño o quitá widgets.
              </span>
              <span className="md:hidden">
                Usá las flechas para reordenar o quitá widgets.
              </span>
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={pending}
              >
                <RotateCcw className="size-3.5" />
                Restablecer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} disabled={pending}>
                <Check className="size-3.5" />
                Guardar
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            Personalizar
          </Button>
        )}
      </div>

      {editing && hiddenIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-xs text-muted-foreground">Agregar:</span>
          {hiddenIds.map((id) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              onClick={() => addWidget(id)}
            >
              <Plus className="size-3.5" />
              {WIDGET_LABEL[id]}
            </Button>
          ))}
        </div>
      )}

      {layout.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Dashboard vacío. {editing ? "Agregá widgets arriba." : "Personalizalo para agregar widgets."}
        </div>
      ) : editing ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={layout.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {layout.map((item, index) => (
                <SortableWidget
                  key={item.id}
                  id={item.id}
                  size={item.size}
                  canMoveUp={index > 0}
                  canMoveDown={index < layout.length - 1}
                  onMoveUp={() => moveWidget(item.id, -1)}
                  onMoveDown={() => moveWidget(item.id, 1)}
                  onToggleSize={() => toggleSize(item.id)}
                  onRemove={() => removeWidget(item.id)}
                >
                  {widgets[item.id]}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {layout.map((item) => (
            <div
              key={item.id}
              className={cn("min-w-0", item.size === "full" && "lg:col-span-2")}
            >
              {widgets[item.id]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableWidget({
  id,
  size,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleSize,
  onRemove,
  children,
}: {
  id: WidgetId;
  size: "half" | "full";
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleSize: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative min-w-0 rounded-lg ring-1 ring-border",
        size === "full" && "lg:col-span-2",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 rounded-md border bg-background px-1 py-0.5 shadow-sm">
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing max-md:hidden"
          aria-label={`Mover ${WIDGET_LABEL[id]}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 md:hidden"
          aria-label={`Subir ${WIDGET_LABEL[id]}`}
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 md:hidden"
          aria-label={`Bajar ${WIDGET_LABEL[id]}`}
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          <ArrowDown className="size-4" />
        </button>
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-foreground max-lg:hidden"
          aria-label={
            size === "full"
              ? `Achicar ${WIDGET_LABEL[id]} a media fila`
              : `Agrandar ${WIDGET_LABEL[id]} a fila completa`
          }
          onClick={onToggleSize}
        >
          {size === "full" ? (
            <Square className="size-3.5" />
          ) : (
            <RectangleHorizontal className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label={`Quitar ${WIDGET_LABEL[id]}`}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="pointer-events-none opacity-90">{children}</div>
    </div>
  );
}
