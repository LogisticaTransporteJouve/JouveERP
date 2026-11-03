"use client";

import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPeriod } from "@/lib/format";

import { taxDocumentLabel, type TaxDocument } from "../schema";

/** The VEP, DDJJ and receipts of a tax document, read only: what a reader
 *  of Impuestos (the accountant included) sees without files:read. */
export function TaxAttachmentsDialog({
  doc,
  onClose,
}: {
  doc: TaxDocument | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjuntos</DialogTitle>
          <DialogDescription>
            {doc
              ? `${taxDocumentLabel(doc)} de ${formatPeriod(doc.period)}: VEP, DDJJ y comprobantes de pago.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {doc && (
          <AttachmentsZone
            targetType="tax_document"
            targetId={doc.id}
            canWrite={false}
            canDelete={false}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
