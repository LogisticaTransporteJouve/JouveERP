"use client";

import { Download, Eye, Search } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FilePreviewDialog } from "@/components/file-preview/file-preview-dialog";
import { MimeIcon } from "@/components/file-preview/mime-icon";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import { formatFileSize } from "@/lib/files/format-file-size";
import { formatArgentineDateTime } from "@/lib/format";
import { runAction } from "@/lib/query/run-action";

import { getHubFileUrlAction } from "../actions/hub-actions";
import { useHubFiles, useHubUploaders } from "../hooks/use-files-hub";
import { filesKeys } from "../lib/files-keys";
import {
  HUB_ENTITY_LABEL,
  HUB_FILE_KINDS,
  HUB_FILE_KIND_LABEL,
  hubEntityHref,
  type HubEntityType,
  type HubFileKind,
} from "../lib/hub";
import type { HubFileRow, HubFilters } from "../schema";

const ANY = "__any__";

type Preview = {
  url: string | null;
  filename: string;
  mimeType: string | null;
};

async function signedUrl(row: HubFileRow, download: boolean) {
  return runAction(() => getHubFileUrlAction(row.linkId, { download }));
}

function useHubColumns(
  onPreview: (row: HubFileRow) => void,
  onDownload: (row: HubFileRow) => void,
): ColumnDef<HubFileRow>[] {
  return useMemo(
    () => [
      {
        id: "file",
        header: "Archivo",
        enableSorting: false,
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onPreview(row.original)}
            className="flex min-w-0 items-center gap-2 text-left hover:underline"
            title={`Ver ${row.original.filename}`}
          >
            <MimeIcon
              mimeType={row.original.mimeType}
              className="text-muted-foreground size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block max-w-[320px] truncate text-sm font-medium">
                {row.original.filename}
              </span>
              <span className="text-muted-foreground block text-xs">
                {formatFileSize(row.original.fileSize)}
              </span>
            </span>
          </button>
        ),
      },
      {
        id: "entity",
        header: "Origen",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <Link
            href={hubEntityHref(row.original)}
            className="text-sm hover:underline"
          >
            {HUB_ENTITY_LABEL[row.original.entityType]}
          </Link>
        ),
      },
      {
        id: "uploader",
        header: "Subido por",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.uploaderName ?? "—"}
          </span>
        ),
      },
      {
        id: "uploadedAt",
        header: "Fecha",
        enableSorting: false,
        meta: { headerClassName: "w-44", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatArgentineDateTime(row.original.uploadedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { align: "right", headerClassName: "w-24", mobile: "primary" },
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="Ver"
              onClick={() => onPreview(row.original)}
            >
              <Eye className="size-4" />
              <span className="sr-only">Ver {row.original.filename}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="Descargar"
              onClick={() => onDownload(row.original)}
            >
              <Download className="size-4" />
              <span className="sr-only">Descargar {row.original.filename}</span>
            </Button>
          </div>
        ),
      },
    ],
    [onPreview, onDownload],
  );
}

export function FilesHub({
  entityTypes,
  initialFilters,
}: {
  entityTypes: readonly HubEntityType[];
  initialFilters: HubFilters;
}) {
  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [entityType, setEntityType] = useState<string>(
    initialFilters.entityType ?? ANY,
  );
  const [fileKind, setFileKind] = useState<string>(
    initialFilters.fileKind ?? ANY,
  );
  const [uploadedBy, setUploadedBy] = useState<string>(
    initialFilters.uploadedBy ?? ANY,
  );
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const filters: HubFilters = {
    search: debouncedSearch || null,
    entityType: entityTypes.find((t) => t === entityType) ?? null,
    fileKind: HUB_FILE_KINDS.find((k) => k === fileKind) ?? null,
    uploadedBy: uploadedBy === ANY ? null : uploadedBy,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  };

  const setUrlFilters = useUrlFilter();
  useEffect(() => {
    setUrlFilters({
      q: filters.search,
      origen: filters.entityType,
      tipo: filters.fileKind,
      por: filters.uploadedBy,
      desde: filters.dateFrom,
      hasta: filters.dateTo,
    });
  }, [
    filters.search,
    filters.entityType,
    filters.fileKind,
    filters.uploadedBy,
    filters.dateFrom,
    filters.dateTo,
    setUrlFilters,
  ]);

  useRealtimeInvalidate([
    { table: "file_attachments", queryKeys: [filesKeys.all] },
  ]);

  async function openPreview(row: HubFileRow) {
    setPreview({ url: null, filename: row.filename, mimeType: row.mimeType });
    try {
      const signed = await signedUrl(row, false);
      setPreview({
        url: signed.url,
        filename: signed.filename,
        mimeType: signed.mimeType,
      });
    } catch (err) {
      setPreview(null);
      toast.error(err instanceof Error ? err.message : "No se pudo abrir.");
    }
  }

  async function download(row: HubFileRow) {
    try {
      const signed = await signedUrl(row, true);
      window.location.assign(signed.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar.");
    }
  }

  const columns = useHubColumns(
    (row) => void openPreview(row),
    (row) => void download(row),
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[260px]">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre"
            className="pl-9"
            aria-label="Buscar archivos por nombre"
          />
        </div>

        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label="Origen">
            <SelectValue placeholder="Origen" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Todos los orígenes</SelectItem>
            {entityTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {HUB_ENTITY_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fileKind} onValueChange={setFileKind}>
          <SelectTrigger
            className="w-full sm:w-[170px]"
            aria-label="Tipo de archivo"
          >
            <SelectValue placeholder="Tipo de archivo" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Cualquier tipo</SelectItem>
            {HUB_FILE_KINDS.map((k: HubFileKind) => (
              <SelectItem key={k} value={k}>
                {HUB_FILE_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Suspense
          fallback={
            <Select disabled>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Subido por" />
              </SelectTrigger>
            </Select>
          }
        >
          <UploaderFilter value={uploadedBy} onChange={setUploadedBy} />
        </Suspense>

        <div className="flex flex-wrap items-center gap-1">
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            placeholder="Desde"
            className="w-[160px]"
            clearable
          />
          <span className="text-muted-foreground text-xs">→</span>
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder="Hasta"
            className="w-[160px]"
            clearable
          />
        </div>
      </div>

      <div className="mt-4">
        <Suspense
          fallback={<DataTable columns={columns} data={[]} isLoading />}
        >
          <HubRows columns={columns} filters={filters} />
        </Suspense>
      </div>

      <FilePreviewDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        url={preview?.url ?? null}
        filename={preview?.filename ?? ""}
        mimeType={preview?.mimeType ?? null}
      />
    </>
  );
}

function UploaderFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { data: people } = useHubUploaders();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-[200px]" aria-label="Subido por">
        <SelectValue placeholder="Subido por" />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ANY}>Cualquier persona</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HubRows({
  columns,
  filters,
}: {
  columns: ColumnDef<HubFileRow>[];
  filters: HubFilters;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useHubFiles(filters);
  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );
  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.linkId}
      emptyMessage="No hay archivos que coincidan."
      footer={
        hasNextPage ? (
          <div
            ref={sentinelRef}
            className="text-muted-foreground py-4 text-center text-xs"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </div>
        ) : null
      }
    />
  );
}
