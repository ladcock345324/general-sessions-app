/**
 * extractPdfText — extracts text from a PDF File/Blob using PDF.js.
 * Returns the extracted string, or null if the PDF has no selectable text
 * or if extraction fails for any reason. Never throws.
 *
 * Worker strategy: point GlobalWorkerOptions.workerSrc at the matching
 * unpkg.com CDN URL. cdnjs does not yet carry pdfjs-dist v6.x, so we use
 * unpkg (the npm CDN) which has every published version. This sidesteps all
 * Vite worker-bundling issues — pdfjs loads the worker itself at runtime.
 */
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs'

export async function extractPdfText(file) {
  let pdfDoc = null
  try {
    const arrayBuffer = await file.arrayBuffer()
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
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
    try { await pdfDoc?.destroy() } catch {}
  }
}
