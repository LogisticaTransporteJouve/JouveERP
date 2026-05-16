"use client";

import { Camera, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  FILE_TYPE_PRESETS,
  type FileTypePreset,
  validateFile,
} from "./file-upload-utils";

type FileDropzoneProps = {
  onFile: (file: File) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  fileType?: FileTypePreset;
  placeholder?: string;
  description?: string;
  className?: string;
};

// Single-file dropzone (D2 — no bulk en K.10). Drag-drop on desktop, two
// explicit buttons on touch devices: "Tomar foto" → camera trasera, "Elegir
// archivo" → OS file picker. Detection via `pointer-coarse:` Tailwind
// variants — no user-agent sniffing.
export function FileDropzone({
  onFile,
  onError,
  disabled = false,
  fileType = "documents",
  placeholder = "Arrastrá un archivo o elegí desde el dispositivo",
  description,
  className,
}: FileDropzoneProps) {
  const preset = FILE_TYPE_PRESETS[fileType];
  const [isDragging, setIsDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file, preset.allowedTypes, preset.maxSize);
      if (error) {
        onError?.(error);
        return;
      }
      onFile(file);
    },
    [preset.allowedTypes, preset.maxSize, onError, onFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const file = event.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile],
  );

  const onPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleFile(file);
      // Reset so re-picking the same file re-triggers onChange.
      event.target.value = "";
    },
    [handleFile],
  );

  const allowedLabels = Object.values(preset.allowedTypes).join(", ");
  const maxMb = Math.round(preset.maxSize / (1024 * 1024));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <Upload className="size-5 text-muted-foreground pointer-coarse:hidden" />
      <p className="text-sm font-medium">{placeholder}</p>
      <p className="text-xs text-muted-foreground">
        {description ?? `${allowedLabels} hasta ${maxMb} MB`}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Camera button: only on touch devices. capture="environment"
            launches the rear camera (better for scanning a comprobante). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className="hidden pointer-coarse:inline-flex"
        >
          <Camera className="size-4" />
          Tomar foto
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => pickerRef.current?.click()}
        >
          Elegir archivo
        </Button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept={preset.cameraAccept}
        capture="environment"
        className="hidden"
        onChange={onPicked}
      />
      <input
        ref={pickerRef}
        type="file"
        accept={preset.acceptString}
        className="hidden"
        onChange={onPicked}
      />
    </div>
  );
}
