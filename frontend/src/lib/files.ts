import { formatBytes } from '@/lib/utils'

function readHead(file: Blob, length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(file.slice(0, length))
  })
}

/**
 * Client-side pre-check for PDF uploads (fast feedback only; the backend validates again and its
 * size limit is authoritative). Returns an error message, or null when the file looks acceptable.
 */
export async function validatePdfFile(file: File, maxBytes: number): Promise<string | null> {
  if (file.size === 0) return 'This file is empty.'
  if (file.size > maxBytes) return `This file is ${formatBytes(file.size)}. The maximum allowed size is ${formatBytes(maxBytes)}.`
  const looksLikePdfName = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
  if (!looksLikePdfName) return 'Choose a PDF file (.pdf).'
  try {
    const head = await readHead(file, 5)
    const magic = String.fromCharCode(...head)
    if (magic !== '%PDF-') return 'This file does not look like a PDF document.'
  } catch {
    return 'This file could not be read. Choose it again.'
  }
  return null
}
