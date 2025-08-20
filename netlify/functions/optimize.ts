import Fastify from 'fastify'
import type { Handler } from '@netlify/functions'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { DocumentService } from '../../src/services/document.service.js'
import { tokenManager } from '../../src/services/token.service.js'
import {
  streamToBuffer,
  detectDocumentType,
  validateFileExtension,
  extractTextFromBuffer
} from '../../src/utils/parser.js'
import { errorHandler, notFoundHandler } from '../../src/middleware/error-handler.js'
import { validateAPIKey, rateLimiter } from '../../src/utils/auth.js'
import { OptimizationRequestSchema, validateRequest } from '../../src/utils/validation.js'
import { errorStrategyManager, withGracefulDegradation } from '../../src/utils/error-strategies.js'
import { errorReporter } from '../../src/utils/error-reporter.js'
import { healthChecker } from '../../src/utils/resilience.js'
import { registerSecurityMiddleware, getCORSOptions } from '../../src/middleware/security.js'
import { env, getEnvironmentHealth } from '../../src/config/environment.js'
import { databaseManager, initializeDatabaseWithRetry } from '../../src/config/database.js'
import { cache, cdnManager } from '../../src/utils/cache.js'
import { backupManager, disasterRecoveryManager } from '../../src/utils/backup.js'
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

// Simple CORS configuration for testing
app.register(cors, {
  origin: true,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
})

// Ensure CORS headers are always present
app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
  
  // Handle preflight OPTIONS requests
  if (request.method === 'OPTIONS') {
    reply.code(200).send()
    return
  }
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

// Register health checks
healthChecker.register('openai', async () => {
  try {
    return await (documentService as any).openaiService.validateConnection()
  } catch {
    return false
  }
})

healthChecker.register('documentService', async () => {
  return errorStrategyManager.isServiceHealthy('documentService')
})

healthChecker.register('tokenManager', async () => {
  try {
    tokenManager.getGlobalStats()
    return true
  } catch {
    return false
  }
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
  const healthResults = await healthChecker.runChecks()
  const errorStats = errorStrategyManager.getErrorStats()
  const reporterStats = errorReporter.getStats()
  
  return {
    status: healthResults.healthy ? 'ok' : 'degraded',
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
    },
    healthChecks: healthResults.checks,
    errorStats: {
      totalErrors: errorStats.totalErrors,
      errorsBySeverity: errorStats.errorsBySeverity,
      recentErrorCount: errorStats.recentErrors.length
    },
    errorReporting: {
      enabled: reporterStats.isEnabled,
      pendingReports: reporterStats.pendingReports,
      totalReported: reporterStats.totalReported
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

app.get('/models', async () => {
  const openaiService = (documentService as any).openaiService
  
  return {
    supported: openaiService.getSupportedModels(),
    capabilities: openaiService.getSupportedModels().reduce((acc: any, model: string) => {
      acc[model] = openaiService.getModelCapabilities(model)
      return acc
    }, {}),
    defaults: {
      clarity: openaiService.getDefaultModelForOptimization('clarity'),
      style: openaiService.getDefaultModelForOptimization('style'),
      consolidate: openaiService.getDefaultModelForOptimization('consolidate'),
      summarize: openaiService.getDefaultModelForOptimization('summarize')
    }
  }
})

app.get('/rate-limit/status', async (request) => {
  const identifier = request.ip
  
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

app.get('/tokens/usage', async (request) => {
  const userId = request.ip
  
  return tokenManager.getUsageStats(userId)
})

app.get('/tokens/budget', async (request) => {
  const userId = request.ip
  
  const query = request.query as { dailyLimit?: string; monthlyLimit?: string } | null
  const dailyLimit = parseInt(query?.dailyLimit || '10000', 10)
  const monthlyLimit = parseInt(query?.monthlyLimit || '250000', 10)
  
  return tokenManager.getTokenBudget(userId, dailyLimit, monthlyLimit)
})

app.get('/tokens/pricing', async () => {
  return {
    models: tokenManager.getModelPricing(),
    lastUpdated: '2024-01-20', // Update this when pricing changes
    currency: 'USD'
  }
})

app.get('/tokens/estimate', async (request) => {
  const query = request.query as { model?: string; tokens?: string } | null
  const model = query?.model || 'gpt-3.5-turbo'
  const tokens = parseInt(query?.tokens || '1000', 10)
  
  const cost = tokenManager.estimateCost(model, tokens)
  
  return {
    model,
    estimatedTokens: tokens,
    estimatedCost: cost,
    costBreakdown: {
      inputTokens: Math.floor(tokens * 0.7),
      outputTokens: Math.floor(tokens * 0.3),
      inputCost: cost * 0.7,
      outputCost: cost * 0.3
    }
  }
})

app.get('/tokens/transactions', async (request) => {
  const userId = request.ip
  const query = request.query as { limit?: string } | null
  const limit = parseInt(query?.limit || '50', 10)
  
  return {
    transactions: tokenManager.getRecentTransactions(userId, limit),
    totalCount: tokenManager.getUsageStats(userId).totalRequests
  }
})

app.post('/optimize', async (request, reply) => {
  try {
    if (process.env.ENABLE_RATE_LIMITING !== 'false') {
      const identifier = request.ip
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
      let model: string | undefined

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

      const userId = request.ip

      const results =
        optimizationType === 'consolidate'
          ? [await documentService.consolidateDocuments(documents, model, userId)]
          : await documentService.processMultipleDocuments(documents, optimizationType, model, userId)

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

      const userId = request.ip

      const results =
        body.optimizationType === 'consolidate'
          ? [await documentService.consolidateDocuments(body.documents, body.model, userId)]
          : await documentService.processMultipleDocuments(
              body.documents,
              body.optimizationType as string,
              body.model,
              userId
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

// Production environment endpoints
app.get('/backup/status', async () => {
  return backupManager.getBackupStatus()
})

app.get('/backup/history', async () => {
  return {
    backups: backupManager.getBackupHistory(),
    enabled: env.BACKUP_ENABLED
  }
})

app.post('/backup/create', async (request) => {
  const query = request.query as { type?: 'full' | 'incremental' | 'differential' } | null
  const type = query?.type || 'incremental'
  
  try {
    const backup = await backupManager.performBackup(type)
    return {
      success: true,
      backup
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Backup failed'
    }
  }
})

app.get('/disaster-recovery/plans', async () => {
  return {
    plans: disasterRecoveryManager.getRecoveryPlans(),
    lastUpdated: new Date().toISOString()
  }
})

app.post('/disaster-recovery/execute', async (request) => {
  const body = request.body as { component: string } | null
  
  if (!body?.component) {
    return { success: false, error: 'Component name required' }
  }
  
  try {
    await disasterRecoveryManager.executeRecoveryPlan(body.component)
    return {
      success: true,
      message: `Recovery plan executed for ${body.component}`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Recovery failed'
    }
  }
})

app.get('/cache/stats', async () => {
  return {
    metrics: cache.getMetrics(),
    enabled: true
  }
})

app.delete('/cache/clear', async () => {
  await cache.clear()
  return { success: true, message: 'Cache cleared successfully' }
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