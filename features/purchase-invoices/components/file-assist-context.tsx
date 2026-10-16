"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PurchaseInvoiceDraft } from "../lib/purchase-invoice-draft";

/**
 * "Fill from file" entry point of the new-invoice dialog. The page decides
 * whether one exists and which one: the dialog renders it and only receives
 * the resulting draft.
 */
export type PurchaseInvoiceFileAssist = (
  onDraft: (draft: PurchaseInvoiceDraft) => void,
) => ReactNode;

const FileAssistContext = createContext<PurchaseInvoiceFileAssist | null>(null);

export function PurchaseInvoiceFileAssistProvider({
  assist,
  children,
}: {
  assist: PurchaseInvoiceFileAssist | null;
  children: React.ReactNode;
}) {
  return (
    <FileAssistContext.Provider value={assist}>
      {children}
    </FileAssistContext.Provider>
  );
}

export function usePurchaseInvoiceFileAssist(): PurchaseInvoiceFileAssist | null {
  return useContext(FileAssistContext);
}
