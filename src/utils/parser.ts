import type { Readable } from 'stream'
import type { DocumentInput } from '../types/index.js'

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export function detectDocumentType(
  filename: string
): 'transcript' | 'policy' | 'email' | 'note' | undefined {
  const name = filename.toLowerCase()

  if (name.includes('transcript') || (name.includes('meeting') && !name.includes('note'))) {
    return 'transcript'
  }
  if (name.includes('policy') || name.includes('handbook')) {
    return 'policy'
  }
  if (name.includes('email') || name.endsWith('.eml')) {
    return 'email'
  }
  if (name.includes('note') || name.includes('memo')) {
    return 'note'
  }

  return undefined
}

export function validateFileExtension(filename: string): boolean {
  const allowedExtensions = ['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf', '.json']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return allowedExtensions.includes(ext)
}

export function parseJSONSafely<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export function extractTextFromBuffer(buffer: Buffer, mimeType?: string): string {
  if (mimeType?.includes('json')) {
    try {
      const json = JSON.parse(buffer.toString('utf-8'))
      return typeof json === 'string' ? json : JSON.stringify(json, null, 2)
    } catch {
      return buffer.toString('utf-8')
    }
  }

  return buffer.toString('utf-8')
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255)
}

export function calculateFileHash(buffer: Buffer): string {
  const crypto = require('crypto')
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export interface ParsedMultipartData {
  documents: DocumentInput[]
  metadata: Record<string, any>
  errors: Array<{ file: string; error: string }>
}