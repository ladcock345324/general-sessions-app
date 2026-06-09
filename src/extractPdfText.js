/**
 * extractPdfText — extracts text from a PDF File/Blob using PDF.js.
 * Returns the extracted string, or null if the PDF has no selectable text
 * or if extraction fails for any reason. Never throws.
 *
 * Worker strategy: uses Vite's ?worker import so Vite bundles and manages
 * the worker correctly. Each call creates a fresh worker instance and passes
 * it directly to PDFWorker({ port }) — bypassing the workerSrc / URL path
 * entirely, which avoids same-origin checks and Blob-wrapper issues in
 * pdfjs-dist v6.
 */
import * as pdfjsLib from 'pdfjs-dist'
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'

export async function extractPdfText(file) {
  let nativeWorker = null
  let pdfDoc = null
  try {
    const arrayBuffer = await file.arrayBuffer()

    // Spin up a fresh Vite-managed worker for this extraction
    nativeWorker = new PdfjsWorker()

    // Wrap it in a PDFWorker so pdfjs manages the message protocol.
    // PDFWorker({ port }) calls #initializeFromPort, which skips the
    // workerSrc / CDN-wrapper code path that can fail in prod.
    const pdfWorker = new pdfjsLib.PDFWorker({ port: nativeWorker })

    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer, worker: pdfWorker }).promise

    const pages = []
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => item.str).join(' '))
    }

    return pages.join('\n').trim() || null
  } catch {
    return null
  } finally {
    // Always clean up — pdf.destroy() removes the port from PDFWorker.#workerPorts
    try { await pdfDoc?.destroy() } catch {}
    try { nativeWorker?.terminate() } catch {}
  }
}
