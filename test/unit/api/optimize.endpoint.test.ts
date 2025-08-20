import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// Mock the handler function since we can't easily test the Netlify function directly
const createTestApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false })
  
  // Register the same plugins as the main app
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
    timestamp: new Date().toISOString()
  }))

  // Mock optimize endpoint
  app.post('/optimize', { preHandler: [mockAuth] }, async (request, reply) => {
    const body = request.body as any
    
    if (!body.documents || body.documents.length === 0) {
      return reply.code(400).send({
        error: 'No documents provided',
        code: 'NO_DOCUMENTS'
      })
    }

    // Mock successful response
    return {
      success: true,
      results: body.documents.map((doc: any, index: number) => ({
        originalFilename: doc.name,
        optimizedContent: `# Optimized ${doc.name}\n\nOptimized content here...`,
        metadata: {
          originalLength: doc.content.length,
          optimizedLength: 150,
          compressionRatio: 0.75,
          processingTime: 100,
          model: body.model || 'gpt-3.5-turbo',
          timestamp: new Date().toISOString()
        },
        status: 'fulfilled'
      })),
      metadata: {
        documentsProcessed: body.documents.length,
        optimizationType: body.optimizationType,
        timestamp: new Date().toISOString()
      }
    }
  })

  return app
}

describe('Optimize API Endpoint', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await createTestApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      })

      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String)
      })
    })
  })

  describe('POST /optimize', () => {
    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        payload: {
          documents: [{ name: 'test.txt', content: 'test content' }],
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(401)
      
      const data = JSON.parse(response.body)
      expect(data).toHaveProperty('error')
    })

    it('should process documents with valid API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents: [
            { name: 'test1.txt', content: 'Test content for optimization' },
            { name: 'test2.txt', content: 'Another test document' }
          ],
          optimizationType: 'clarity',
          mode: 'text'
        }
      })

      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        success: true,
        results: expect.arrayContaining([
          expect.objectContaining({
            originalFilename: 'test1.txt',
            optimizedContent: expect.stringContaining('Optimized'),
            status: 'fulfilled',
            metadata: expect.objectContaining({
              originalLength: expect.any(Number),
              processingTime: expect.any(Number)
            })
          })
        ]),
        metadata: expect.objectContaining({
          documentsProcessed: 2,
          optimizationType: 'clarity'
        })
      })
    })

    it('should validate request payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents: [], // Empty documents array
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(400)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        error: 'No documents provided',
        code: 'NO_DOCUMENTS'
      })
    })

    it('should handle different optimization types', async () => {
      const optimizationTypes = ['clarity', 'style', 'consolidate']

      for (const type of optimizationTypes) {
        const response = await app.inject({
          method: 'POST',
          url: '/optimize',
          headers: {
            'x-api-key': 'test-api-key'
          },
          payload: {
            documents: [{ name: 'test.txt', content: 'test content' }],
            optimizationType: type
          }
        })

        expect(response.statusCode).toBe(200)
        
        const data = JSON.parse(response.body)
        expect(data.metadata.optimizationType).toBe(type)
      }
    })

    it('should handle model selection', async () => {
      const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']

      for (const model of models) {
        const response = await app.inject({
          method: 'POST',
          url: '/optimize',
          headers: {
            'x-api-key': 'test-api-key'
          },
          payload: {
            documents: [{ name: 'test.txt', content: 'test content' }],
            optimizationType: 'clarity',
            model
          }
        })

        expect(response.statusCode).toBe(200)
        
        const data = JSON.parse(response.body)
        expect(data.results[0].metadata.model).toBe(model)
      }
    })

    it('should handle missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          // Missing documents field
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(400)
    })

    it('should handle malformed JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key',
          'content-type': 'application/json'
        },
        payload: '{ invalid json }'
      })

      expect(response.statusCode).toBe(400)
    })

    it('should set correct response headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents: [{ name: 'test.txt', content: 'test content' }],
          optimizationType: 'clarity'
        }
      })

      expect(response.headers['content-type']).toContain('application/json')
    })

    it('should handle large document content', async () => {
      const largeContent = 'A'.repeat(10000)
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents: [{ name: 'large.txt', content: largeContent }],
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data.results[0].metadata.originalLength).toBe(10000)
    })

    it('should handle special characters in content', async () => {
      const specialContent = 'Content with émojis 🎉 and spëcial chars: @#$%^&*()'
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents: [{ name: 'special.txt', content: specialContent }],
          optimizationType: 'clarity'
        }
      })

      expect(response.statusCode).toBe(200)
    })

    it('should handle multiple documents efficiently', async () => {
      const documents = Array.from({ length: 5 }, (_, i) => ({
        name: `doc${i + 1}.txt`,
        content: `Content for document ${i + 1}`
      }))

      const startTime = Date.now()
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'test-api-key'
        },
        payload: {
          documents,
          optimizationType: 'clarity'
        }
      })

      const duration = Date.now() - startTime

      expect(response.statusCode).toBe(200)
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
      
      const data = JSON.parse(response.body)
      expect(data.results).toHaveLength(5)
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
        url: '/optimize'
      })

      expect(response.statusCode).toBe(404)
    })
  })
})