import Fastify from 'fastify'
import type { Handler } from '@netlify/functions'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { DocumentService } from '../../src/services/document.service.js'
import {
  streamToBuffer,
  detectDocumentType,
  validateFileExtension,
  extractTextFromBuffer
} from '../../src/utils/parser.js'
import { errorHandler, notFoundHandler } from '../../src/middleware/error-handler.js'
import { validateAPIKey, rateLimiter } from '../../src/utils/auth.js'
import type { DocumentInput } from '../../src/types/index.js'

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
  endpoint: 'streaming',
  timestamp: new Date().toISOString()
}))

app.post('/stream', { preHandler: [validateAPIKey] }, async (request, reply) => {
  try {
    // Rate limiting check
    if (process.env.ENABLE_RATE_LIMITING !== 'false') {
      const apiKey = request.headers['x-api-key']
      const identifier = typeof apiKey === 'string' ? apiKey : request.ip
      const rateLimitInfo = await rateLimiter.checkLimit(identifier)
      
      reply.header('X-RateLimit-Limit', rateLimitInfo.limit.toString())
      reply.header('X-RateLimit-Remaining', rateLimitInfo.remaining.toString())
      reply.header('X-RateLimit-Reset', Math.ceil(rateLimitInfo.resetTime / 1000).toString())
      
      if (!rateLimitInfo.allowed) {
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          timestamp: new Date().toISOString()
        })
      }
    }

    const contentType = request.headers['content-type']
    
    // Set headers for Server-Sent Events
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Headers', 'Cache-Control')

    let document: DocumentInput | undefined
    let optimizationType = 'clarity'
    let model: string | undefined

    if (contentType?.includes('multipart/form-data')) {
      const parts = request.parts()
      let documentFound = false

      for await (const part of parts) {
        if (part.type === 'file' && !documentFound) {
          if (!validateFileExtension(part.filename)) {
            app.log.warn(`Invalid file extension: ${part.filename}`)
            continue
          }

          const buffer = await streamToBuffer(part.file)
          const content = extractTextFromBuffer(buffer, part.mimetype)

          document = {
            name: part.filename,
            content: content,
            type: detectDocumentType(part.filename),
            metadata: {
              size: buffer.length,
              mimetype: part.mimetype
            }
          }
          documentFound = true
        } else if (part.type === 'field') {
          switch (part.fieldname) {
            case 'optimizationType':
              optimizationType = (part as any).value as string
              break
            case 'model':
              model = (part as any).value as string
              break
          }
        }
      }

      if (!document) {
        return reply.code(400).send({
          error: 'No valid document provided',
          code: 'NO_DOCUMENT',
          timestamp: new Date().toISOString()
        })
      }
    } else {
      const body = request.body as any
      
      if (!body.document) {
        return reply.code(400).send({
          error: 'No document provided in request body',
          code: 'NO_DOCUMENT',
          timestamp: new Date().toISOString()
        })
      }

      document = body.document
      optimizationType = body.optimizationType || 'clarity'
      model = body.model
    }

    if (!document) {
      return reply.code(400).send({
        error: 'No document found',
        code: 'NO_DOCUMENT',
        timestamp: new Date().toISOString()
      })
    }

    const apiKey = request.headers['x-api-key']
    const userId = typeof apiKey === 'string' ? apiKey : request.ip

    // Get the OpenAI service and create streaming completion
    const openaiService = (documentService as any).openaiService
    const selectedModel = model || openaiService.getDefaultModelForOptimization(optimizationType)

    // Validate model supports streaming
    const capabilities = openaiService.getModelCapabilities(selectedModel)
    if (!capabilities.supportsStreaming) {
      return reply.code(400).send({
        error: `Model ${selectedModel} does not support streaming`,
        code: 'STREAMING_NOT_SUPPORTED',
        timestamp: new Date().toISOString()
      })
    }

    // Build the optimization prompt
    const messages = buildOptimizationPrompt(document, optimizationType)

    // Start streaming response
    reply.raw.write(`data: ${JSON.stringify({ 
      type: 'start', 
      model: selectedModel,
      document: document.name,
      optimizationType 
    })}\n\n`)

    try {
      const stream = await openaiService.createStreamingCompletion(messages, {
        model: selectedModel,
        temperature: 0.1,
        maxTokens: 4000
      })

      let fullContent = ''
      let tokenCount = 0

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        
        if (content) {
          fullContent += content
          tokenCount++
          
          reply.raw.write(`data: ${JSON.stringify({
            type: 'content',
            content: content,
            tokens: tokenCount
          })}\n\n`)
        }
      }

      // Send completion event
      reply.raw.write(`data: ${JSON.stringify({
        type: 'complete',
        totalTokens: tokenCount,
        length: fullContent.length,
        model: selectedModel,
        timestamp: new Date().toISOString()
      })}\n\n`)

      reply.raw.write('data: [DONE]\n\n')

    } catch (streamError) {
      app.log.error('Streaming error:', streamError as any)
      
      reply.raw.write(`data: ${JSON.stringify({
        type: 'error',
        error: streamError instanceof Error ? streamError.message : 'Streaming failed',
        timestamp: new Date().toISOString()
      })}\n\n`)
    }

    reply.raw.end()

  } catch (error) {
    app.log.error('Stream endpoint error:', error as any)
    return reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

function buildOptimizationPrompt(document: DocumentInput, optimizationType: string) {
  const systemPrompt = getSystemPrompt(optimizationType)
  const userPrompt = getUserPrompt(document, optimizationType)

  return [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt }
  ]
}

function getSystemPrompt(optimizationType: string): string {
  const basePrompt = "You are an expert document optimizer and technical writer."

  switch (optimizationType) {
    case 'clarity':
      return `${basePrompt} Your task is to optimize documents for maximum clarity and readability. Focus on:
- Simplifying complex language without losing meaning
- Breaking down long sentences
- Converting passive voice to active voice
- Eliminating jargon and redundancy
- Improving logical flow and structure
- Making content accessible to a broader audience`

    case 'style':
      return `${basePrompt} Your task is to optimize documents for consistent professional style. Focus on:
- Maintaining consistent tone and voice throughout
- Standardizing terminology and formatting
- Using professional business language
- Ensuring parallel structure in lists and sections
- Improving readability while maintaining formality
- Creating cohesive flow between sections`

    case 'summarize':
      return `${basePrompt} Your task is to create concise, comprehensive summaries. Focus on:
- Identifying and preserving key information
- Eliminating unnecessary details
- Maintaining context and meaning
- Creating logical structure
- Highlighting actionable items
- Providing clear conclusions`

    default:
      return `${basePrompt} Your task is to optimize the document for improved readability, clarity, and professional presentation.`
  }
}

function getUserPrompt(document: DocumentInput, optimizationType: string): string {
  const action = getActionVerb(optimizationType)
  
  return `Please ${action} the following document:

**Document Name:** ${document.name}
**Document Type:** ${document.type || 'Unknown'}

**Content:**
${document.content}

**Instructions:**
1. ${action.charAt(0).toUpperCase() + action.slice(1)} the content according to the specified optimization type
2. Maintain all critical information and context
3. Provide clear structure with appropriate headings
4. Ensure the result is professional and polished
5. Return only the optimized content without meta-commentary`
}

function getActionVerb(optimizationType: string): string {
  switch (optimizationType) {
    case 'clarity': return 'clarify and improve the readability of'
    case 'style': return 'standardize the style and tone of'
    case 'summarize': return 'summarize'
    case 'consolidate': return 'consolidate'
    default: return 'optimize'
  }
}

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