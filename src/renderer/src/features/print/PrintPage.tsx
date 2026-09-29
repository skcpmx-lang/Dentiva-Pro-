/**
 * Print window: the hidden BrowserWindow loads this route and the main process collects the document
 * through `print.ready`. The window renders the same component as the on-screen preview, so the printed
 * sheet and the preview can never diverge.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { PrintDocument } from '@shared/printing/model'
import { invoke, errorMessage } from '../../lib/api'
import { ErrorState, LoadingState } from '../../components/ui'
import { PrintDocumentView } from './PrintDocumentView'

export function PrintPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [document, setDocument] = useState<PrintDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      setError('The print job id is missing.')
      return
    }
    let cancelled = false
    invoke('print.ready', { jobId })
      .then((result) => {
        if (!cancelled) setDocument(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, 'The document for this print job could not be loaded.'))
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (error) return <ErrorState message={error} />
  if (!document) return <LoadingState label="Preparing the document…" />
  return <PrintDocumentView document={document} />
}
