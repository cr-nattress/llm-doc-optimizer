import { z } from 'zod'
import type { FastifyRequest, FastifyReply } from 'fastify'

export const DocumentInputSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1).max(1000000),
  type: z.enum(['transcript', 'policy', 'email', 'note']).optional(),
  metadata: z.record(z.unknown()).optional()
})

export const OptimizationRequestSchema = z.object({
  documents: z.array(DocumentInputSchema).min(1).max(100),
  mode: z.enum(['text', 'json', 'all']).default('text'),
  optimizationType: z.enum(['clarity', 'style', 'consolidate']).default('clarity'),
  model: z.enum(['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(100).max(8000).optional()
})

export const ConfigurationSchema = z.object({
  apiKey: z.string().min(1),
  enableStreaming: z.boolean().default(false),
  enableRateLimiting: z.boolean().default(true),
  maxFileSize: z.number().min(1024).max(52428800).default(10485760),
  maxFiles: z.number().min(1).max(100).default(10),
  allowedFileTypes: z
    .array(z.string())
    .default(['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf', '.json'])
})

export async function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Promise<{ success: true; data: T } | { success: false; errors: z.ZodError }> {
  try {
    const validated = await schema.parseAsync(data)
    return { success: true, data: validated }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error }
    }
    throw error
  }
}

export function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await validateRequest(schema, request.body)

    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.errors.format(),
        timestamp: new Date().toISOString()
      })
    }

    request.body = result.data
  }
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
}

export function validateEnvironmentVariables(): void {
  const required = ['OPENAI_API_KEY']
  const missing: string[] = []

  for (const variable of required) {
    if (!process.env[variable]) {
      missing.push(variable)
    }
  }

  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}

export const FileUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.string(),
  encoding: z.string(),
  file: z.instanceof(Buffer)
})

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc')
})

export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}

export function validateFileSize(size: number, maxSize: number): boolean {
  return size > 0 && size <= maxSize
}

export function validateMimeType(mimetype: string, allowedTypes: string[]): boolean {
  return allowedTypes.some((type) => {
    if (type.includes('*')) {
      const [mainType] = type.split('/')
      return mimetype.startsWith(`${mainType}/`)
    }
    return mimetype === type
  })
}

export const allowedMimeTypes = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/json',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf'
]