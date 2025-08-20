import Fastify from 'fastify'
import type { Handler } from '@netlify/functions'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { DocumentService } from '../../src/services/document.service.js'
import {
  streamToBuffer,
  detectDocumentType,
  validateFileExtension,
  extractTextFromBuffer
} from '../../src/utils/parser.js'
import { errorHandler, notFoundHandler } from '../../src/middleware/error-handler.js'
import { validateAPIKey, rateLimiter } from '../../src/utils/auth.js'
import { OptimizationRequestSchema, validateRequest } from '../../src/utils/validation.js'
import type { DocumentInput, OptimizationRequest } from '../../src/types/index.js'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname'
            }
          }
        : undefined
  },
  bodyLimit: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10)
})

app.register(multipart, {
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
    files: parseInt(process.env.MAX_FILES || '10', 10),
    fields: 10
  }
})

app.register(cors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
})

if (process.env.JWT_SECRET) {
  app.register(jwt, {
    secret: process.env.JWT_SECRET
  })
}

const documentService = new DocumentService({
  apiKey: process.env.OPENAI_API_KEY || '',
  organization: process.env.OPENAI_ORGANIZATION,
  timeout: 60000,
  maxRetries: 3
})

app.setErrorHandler(errorHandler)
app.setNotFoundHandler(notFoundHandler)

app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development',
  version: '1.0.0'
}))

app.get('/health/detailed', async () => {
  const circuitBreakerStatus = documentService.getCircuitBreakerStatus()
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    services: {
      openai: {
        circuitBreaker: circuitBreakerStatus.state,
        failureCount: circuitBreakerStatus.failureCount,
        lastFailureTime: circuitBreakerStatus.lastFailureTime,
        healthy: circuitBreakerStatus.isHealthy
      }
    }
  }
})

app.get('/', async () => ({
  name: 'LLM Document Optimizer',
  version: '1.0.0',
  endpoints: [
    'GET /health - Health check',
    'POST /optimize - Document optimization endpoint',
    'GET /models - List available models'
  ]
}))

app.get('/models', async () => ({
  models: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
  default: 'gpt-3.5-turbo'
}))

app.get('/rate-limit/status', { preHandler: [validateAPIKey] }, async (request) => {
  const apiKey = request.headers['x-api-key']
  const identifier = typeof apiKey === 'string' ? apiKey : request.ip
  
  return {
    requests: {
      remaining: rateLimiter.getRemainingRequests(identifier),
      limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      resetTime: rateLimiter.getResetTime(identifier)
    },
    tokens: {
      remaining: rateLimiter.getRemainingTokens(identifier),
      limit: parseInt(process.env.RATE_LIMIT_TOKENS || '50000', 10),
      resetTime: rateLimiter.getTokenResetTime(identifier)
    },
    stats: rateLimiter.getStats(),
    enabled: process.env.ENABLE_RATE_LIMITING !== 'false'
  }
})

app.post('/optimize', { preHandler: [validateAPIKey] }, async (request, reply) => {
  try {
    if (process.env.ENABLE_RATE_LIMITING !== 'false') {
      const apiKey = request.headers['x-api-key']
      const identifier = typeof apiKey === 'string' ? apiKey : request.ip
      const rateLimitInfo = await rateLimiter.checkLimit(identifier)
      
      // Add rate limit headers to response
      reply.header('X-RateLimit-Limit', rateLimitInfo.limit.toString())
      reply.header('X-RateLimit-Remaining', rateLimitInfo.remaining.toString())
      reply.header('X-RateLimit-Reset', Math.ceil(rateLimitInfo.resetTime / 1000).toString())
      
      if (!rateLimitInfo.allowed) {
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            limit: rateLimitInfo.limit,
            remaining: rateLimitInfo.remaining,
            resetTime: rateLimitInfo.resetTime
          },
          timestamp: new Date().toISOString()
        })
      }
    }
    const contentType = request.headers['content-type']

    if (contentType?.includes('multipart/form-data')) {
      const parts = request.parts()
      const documents: DocumentInput[] = []
      let optimizationType = 'clarity'
      let mode = 'text'
      let model = 'gpt-3.5-turbo'

      for await (const part of parts) {
        if (part.type === 'file') {
          if (!validateFileExtension(part.filename)) {
            app.log.warn(`Invalid file extension: ${part.filename}`)
            continue
          }

          const buffer = await streamToBuffer(part.file)
          const content = extractTextFromBuffer(buffer, part.mimetype)

          documents.push({
            name: part.filename,
            content: content,
            type: detectDocumentType(part.filename),
            metadata: {
              size: buffer.length,
              mimetype: part.mimetype
            }
          })
        } else {
          switch (part.fieldname) {
            case 'optimizationType':
              optimizationType = part.value as string
              break
            case 'mode':
              mode = part.value as string
              break
            case 'model':
              model = part.value as string
              break
          }
        }
      }

      if (documents.length === 0) {
        return reply.code(400).send({
          error: 'No valid documents provided',
          code: 'NO_DOCUMENTS',
          timestamp: new Date().toISOString()
        })
      }

      const results =
        optimizationType === 'consolidate'
          ? [await documentService.consolidateDocuments(documents)]
          : await documentService.processMultipleDocuments(documents, optimizationType, model)

      return {
        success: true,
        results,
        metadata: {
          documentsProcessed: documents.length,
          optimizationType,
          mode,
          model,
          timestamp: new Date().toISOString()
        }
      }
    } else {
      const validation = await validateRequest(OptimizationRequestSchema, request.body)
      
      if (!validation.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: validation.errors.format(),
          timestamp: new Date().toISOString()
        })
      }
      
      const body = validation.data

      if (!body.documents || body.documents.length === 0) {
        return reply.code(400).send({
          error: 'No documents provided in request body',
          code: 'NO_DOCUMENTS',
          timestamp: new Date().toISOString()
        })
      }

      const results =
        body.optimizationType === 'consolidate'
          ? [await documentService.consolidateDocuments(body.documents)]
          : await documentService.processMultipleDocuments(
              body.documents,
              body.optimizationType as string,
              body.model
            )

      return {
        success: true,
        results,
        metadata: {
          documentsProcessed: body.documents.length,
          optimizationType: body.optimizationType,
          mode: body.mode,
          model: body.model ?? 'gpt-3.5-turbo',
          timestamp: new Date().toISOString()
        }
      }
    }
  } catch (error) {
    app.log.error(error)
    return reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

export const handler: Handler = async (event, context) => {
  await app.ready()

  const response = await app.inject({
    method: event.httpMethod as any,
    url: event.path,
    headers: event.headers as any,
    body: event.body || undefined,
    payload: event.body || undefined
  })

  return {
    statusCode: response.statusCode,
    headers: response.headers as any,
    body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
  }
}