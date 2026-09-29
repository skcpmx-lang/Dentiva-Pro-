/**
 * Print document building for the `print.build` channel.
 *
 * Kept outside the Electron entry point so the desktop host and the maintenance tooling (the browser
 * preview harness) build exactly the same document from the same request.
 */

import type { IpcPayload } from '@shared/ipc'
import type { PrintDocument } from '@shared/printing/model'
import type { Services } from '../services/container'

export function buildPrintDocument(services: Services, payload: IpcPayload<'print.build'>): PrintDocument {
  if (payload.documentType === 'prescription') {
    return services.admin.buildPrescriptionDocumentPrint(payload.entityId, payload.paper)
  }
  if (payload.documentType === 'invoice') {
    return services.admin.buildInvoiceDocumentPrint(payload.entityId, payload.paper)
  }
  if (!payload.reportRequest) {
    throw new Error('Printing a report needs the report definition.')
  }
  return services.admin.buildReportPrint(payload.reportRequest)
}
