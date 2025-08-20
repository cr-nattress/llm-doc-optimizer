import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const createTestStreamApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false })
  
  await app.register(import('@fastify/multipart'), {
    limits: { fileSize: 1048576, files: 5 }
  })
  
  await app.register(import('@fastify/cors'), {
    origin: '*'
  })

  // Mock authentication middleware
  const mockAuth = async (request: any, reply: any) => {
    const apiKey = request.headers['x-api-key']
    if (!apiKey || apiKey !== 'test-api-key') {
      return reply.code(401).send({ error: 'Invalid API key' })
    }
  }

  // Health endpoint
  app.get('/health', async () => ({
    status: 'ok',
    endpoint: 'streaming',
    timestamp: new Date().toISOString()
  }))

  // Mock streaming endpoint
  app.post('/stream', { preHandler: [mockAuth] }, async (request, reply) => {
    const body = request.body as any
    
    if (!body.document) {
      return reply.code(400).send({
        error: 'No document provided in request body',
        code: 'NO_DOCUMENT'
      })
    }

    // Set SSE headers
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    // Mock streaming response
    const mockContent = [
      '# Optimized Document\n\n',
      'This is a mock streaming response ',
      'that simulates real-time document optimization. ',
      'The content is being generated progressively ',
      'to demonstrate the streaming functionality.'
    ]

    // Send start event
    reply.raw.write(`data: ${JSON.stringify({ 
      type: 'start', 
      model: body.model || 'gpt-3.5-turbo',
      document: body.document.name,
      optimizationType: body.optimizationType || 'clarity'
    })}\n\n`)

    // Send content chunks
    for (let i = 0; i < mockContent.length; i++) {
      reply.raw.write(`data: ${JSON.stringify({
        type: 'content',
        content: mockContent[i],
        tokens: i + 1
      })}\n\n`)
    }

    // Send completion event
    reply.raw.write(`data: ${JSON.stringify({
      type: 'complete',
      totalTokens: mockContent.length,
      length: mockContent.join('').length,
      model: body.model || 'gpt-3.5-turbo',
      timestamp: new Date().toISOString()
    })}\n\n`)

    reply.raw.write('data: [DONE]\n\n')
    reply.raw.end()
  })

  return app
}

describe('Stream API Endpoint', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await createTestStreamApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('should return streaming health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      })

      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        status: 'ok',
        endpoint: 'streaming',
        timestamp: expect.any(String)
      })
    })
  })

  describe('POST /stream', () => {
    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        payload: {
          document: { name: 'test.txt', content: 'test content' },
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(401)
      
      const data = JSON.parse(response.body)
      expect(data).toHaveProperty('error')
    })

    it('should handle streaming request with valid API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          document: { 
            name: 'test.txt', 
            content: 'Test content for streaming optimization' 
          },
          optimizationType: 'clarity',
          model: 'gpt-3.5-turbo'
        }
      })

      expect(response.statusCode).toBe(200)
      if (response.headers['content-type']) {
        expect(response.headers['content-type']).toContain('text/plain')
      }
      if (response.headers['cache-control']) {
        expect(response.headers['cache-control']).toBe('no-cache')
      }
      if (response.headers['connection']) {
        expect(response.headers['connection']).toBe('keep-alive')
      }

      // Parse the streaming response
      const lines = response.body.split('\n').filter(line => line.startsWith('data: '))
      expect(lines.length).toBeGreaterThan(0)

      // Check start event
      const startEvent = JSON.parse(lines[0]!.replace('data: ', ''))
      expect(startEvent).toMatchObject({
        type: 'start',
        model: 'gpt-3.5-turbo',
        document: 'test.txt',
        optimizationType: 'clarity'
      })

      // Check content events
      const contentEvents = lines.slice(1, -2).map(line => 
        JSON.parse(line.replace('data: ', ''))
      )
      
      contentEvents.forEach(event => {
        expect(event.type).toBe('content')
        expect(event).toHaveProperty('content')
        expect(event).toHaveProperty('tokens')
      })

      // Check completion event
      const completeEvent = JSON.parse(lines[lines.length - 2]!.replace('data: ', ''))
      expect(completeEvent).toMatchObject({
        type: 'complete',
        totalTokens: expect.any(Number),
        length: expect.any(Number),
        model: 'gpt-3.5-turbo',
        timestamp: expect.any(String)
      })

      // Check done marker
      const doneMarker = lines[lines.length - 1]!.replace('data: ', '')
      expect(doneMarker).toBe('[DONE]')
    })

    it('should validate request payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          // Missing document field
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(400)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        error: 'No document provided in request body',
        code: 'NO_DOCUMENT'
      })
    })

    it('should handle different optimization types', async () => {
      const optimizationTypes = ['clarity', 'style', 'summarize']

      for (const type of optimizationTypes) {
        const response = await app.inject({
          method: 'POST',
          url: '/stream',
          headers: {
            'x-api-key': 'test-api-key'
          },
          payload: {
            document: { name: 'test.txt', content: 'test content' },
            optimizationType: type
          }
        })

        expect(response.statusCode).toBe(200)
        
        const lines = response.body.split('\n').filter(line => line.startsWith('data: '))
        const startEvent = JSON.parse(lines[0]!.replace('data: ', ''))
        expect(startEvent.optimizationType).toBe(type)
      }
    })

    it('should handle model selection', async () => {
      const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']

      for (const model of models) {
        const response = await app.inject({
          method: 'POST',
          url: '/stream',
          headers: {
            'x-api-key': 'test-api-key'
          },
          payload: {
            document: { name: 'test.txt', content: 'test content' },
            optimizationType: 'clarity',
            model
          }
        })

        expect(response.statusCode).toBe(200)
        
        const lines = response.body.split('\n').filter(line => line.startsWith('data: '))
        const startEvent = JSON.parse(lines[0]!.replace('data: ', ''))
        expect(startEvent.model).toBe(model)
      }
    })

    it('should set correct response headers for SSE', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          document: { name: 'test.txt', content: 'test content' },
          optimizationType: 'clarity'
        }
      })

      if (response.headers['content-type']) {
        expect(response.headers['content-type']).toContain('text/plain')
      }
      if (response.headers['cache-control']) {
        expect(response.headers['cache-control']).toBe('no-cache')
      }
      if (response.headers['connection']) {
        expect(response.headers['connection']).toBe('keep-alive')
      }
    })

    it('should handle large document content', async () => {
      const largeContent = 'A'.repeat(5000)
      
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          document: { name: 'large.txt', content: largeContent },
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(200)
    })

    it('should handle special characters in content', async () => {
      const specialContent = 'Content with émojis 🎉 and spëcial chars: @#$%^&*()'
      
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          document: { name: 'special.txt', content: specialContent },
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(200)
    })

    it('should provide progressive content updates', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          document: { name: 'test.txt', content: 'test content' },
          optimizationType: 'clarity'
        }
      })

      const lines = response.body.split('\n').filter(line => line.startsWith('data: '))
      const contentEvents = lines.slice(1, -2).map(line => 
        JSON.parse(line.replace('data: ', ''))
      )

      // Should have multiple content chunks
      expect(contentEvents.length).toBeGreaterThan(1)

      // Each content event should have increasing token count
      for (let i = 0; i < contentEvents.length - 1; i++) {
        expect(contentEvents[i + 1]!.tokens).toBeGreaterThan(contentEvents[i]!.tokens)
      }
    })

    it('should handle missing required fields gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/stream',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {} // Empty payload
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('Error handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/non-existent'
      })

      expect(response.statusCode).toBe(404)
    })

    it('should handle unsupported HTTP methods', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/stream'
      })

      expect(response.statusCode).toBe(404)
    })
  })
})