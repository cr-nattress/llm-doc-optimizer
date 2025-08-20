import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import FormData from 'form-data'
import fetch from 'node-fetch'

// These tests would run against a local Netlify dev server
// In a real CI/CD environment, you'd start the server automatically

const BASE_URL = 'http://localhost:8888/.netlify/functions'
const API_KEY = 'test-api-key'

describe('End-to-End API Tests', () => {
  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000))
  })

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/optimize/health`)
      
      expect(response.status).toBe(200)
      
      const data = await response.json()
      expect(data).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String)
      })
    })
  })

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: [{ name: 'test.txt', content: 'test' }],
          optimizationType: 'clarity'
        })
      })

      expect(response.status).toBe(401)
    })

    it('should accept requests with valid API key', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          documents: [{ name: 'test.txt', content: 'Test content for optimization' }],
          optimizationType: 'clarity'
        })
      })

      expect(response.status).toBe(200)
    })
  })

  describe('Document Optimization', () => {
    it('should optimize single document via JSON', async () => {
      const payload = {
        documents: [{
          name: 'business-plan.txt',
          content: 'Our company plans to expand into new markets. We will focus on customer acquisition and retention strategies. The projected growth rate is 15% annually.',
          type: 'note'
        }],
        optimizationType: 'clarity',
        mode: 'text',
        model: 'gpt-3.5-turbo'
      }

      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify(payload)
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result).toMatchObject({
        success: true,
        results: expect.arrayContaining([
          expect.objectContaining({
            originalFilename: 'business-plan.txt',
            optimizedContent: expect.stringContaining('Clarity-Optimized'),
            status: 'fulfilled',
            metadata: expect.objectContaining({
              originalLength: expect.any(Number),
              optimizedLength: expect.any(Number),
              model: 'gpt-3.5-turbo'
            })
          })
        ]),
        metadata: expect.objectContaining({
          documentsProcessed: 1,
          optimizationType: 'clarity'
        })
      })
    })

    it('should optimize multiple documents', async () => {
      const payload = {
        documents: [
          {
            name: 'policy1.txt',
            content: 'Company policy regarding remote work arrangements and expectations.',
            type: 'policy'
          },
          {
            name: 'meeting.txt',
            content: 'Team meeting notes from quarterly planning session.',
            type: 'transcript'
          },
          {
            name: 'email.txt',
            content: 'Email communication regarding project timeline updates.',
            type: 'email'
          }
        ],
        optimizationType: 'style',
        mode: 'text'
      }

      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify(payload)
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(3)
      expect(result.metadata.documentsProcessed).toBe(3)
      
      result.results.forEach((doc: any) => {
        expect(doc.status).toBe('fulfilled')
        expect(doc.optimizedContent).toContain('Style-Optimized')
      })
    })

    it('should consolidate multiple documents', async () => {
      const payload = {
        documents: [
          {
            name: 'doc1.txt',
            content: 'First document with important information about project requirements.',
            type: 'note'
          },
          {
            name: 'doc2.txt',
            content: 'Second document containing additional project specifications.',
            type: 'note'
          }
        ],
        optimizationType: 'consolidate',
        mode: 'text'
      }

      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify(payload)
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].originalFilename).toBe('consolidated_document')
      expect(result.results[0].optimizedContent).toContain('Consolidated Document')
    })

    it('should handle different models', async () => {
      const models = ['gpt-3.5-turbo', 'gpt-4']

      for (const model of models) {
        const payload = {
          documents: [{
            name: 'test.txt',
            content: 'Test content for model comparison',
            type: 'note'
          }],
          optimizationType: 'clarity',
          model
        }

        const response = await fetch(`${BASE_URL}/optimize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY
          },
          body: JSON.stringify(payload)
        })

        expect(response.status).toBe(200)
        
        const result = await response.json()
        expect(result.results[0].metadata.model).toBe(model)
      }
    })
  })

  describe('Multipart Upload', () => {
    it('should handle file uploads via multipart form', async () => {
      const form = new FormData()
      
      // Add files
      form.append('files', Buffer.from('First document content'), {
        filename: 'doc1.txt',
        contentType: 'text/plain'
      })
      form.append('files', Buffer.from('Second document content'), {
        filename: 'doc2.txt',
        contentType: 'text/plain'
      })
      
      // Add form fields
      form.append('optimizationType', 'clarity')
      form.append('mode', 'text')

      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          ...form.getHeaders()
        },
        body: form
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
    })

    it('should handle mixed content types', async () => {
      const form = new FormData()
      
      form.append('files', Buffer.from(JSON.stringify({ content: 'JSON data' })), {
        filename: 'data.json',
        contentType: 'application/json'
      })
      form.append('files', Buffer.from('Plain text content'), {
        filename: 'text.txt',
        contentType: 'text/plain'
      })
      
      form.append('optimizationType', 'style')

      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          ...form.getHeaders()
        },
        body: form
      })

      expect(response.status).toBe(200)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid JSON payload', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: '{ invalid json }'
      })

      expect(response.status).toBe(400)
    })

    it('should handle missing documents', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          optimizationType: 'clarity'
          // Missing documents field
        })
      })

      expect(response.status).toBe(400)
      
      const result = await response.json()
      expect(result.error).toBeDefined()
    })

    it('should handle empty documents array', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          documents: [],
          optimizationType: 'clarity'
        })
      })

      expect(response.status).toBe(400)
    })

    it('should handle unsupported HTTP methods', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'PUT',
        headers: { 'x-api-key': API_KEY }
      })

      expect(response.status).toBe(404)
    })
  })

  describe('Performance', () => {
    it('should handle concurrent requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        fetch(`${BASE_URL}/optimize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY
          },
          body: JSON.stringify({
            documents: [{
              name: `doc${i}.txt`,
              content: `Document ${i} content for concurrent testing`,
              type: 'note'
            }],
            optimizationType: 'clarity'
          })
        })
      )

      const startTime = Date.now()
      const responses = await Promise.all(requests)
      const duration = Date.now() - startTime

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000) // 10 seconds
    })

    it('should handle large document content', async () => {
      const largeContent = 'A'.repeat(50000) // 50KB content
      
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          documents: [{
            name: 'large-doc.txt',
            content: largeContent,
            type: 'note'
          }],
          optimizationType: 'clarity'
        })
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.results[0].metadata.originalLength).toBe(50000)
    })
  })

  describe('Response Format', () => {
    it('should return consistent response structure', async () => {
      const response = await fetch(`${BASE_URL}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          documents: [{
            name: 'test.txt',
            content: 'Test content',
            type: 'note'
          }],
          optimizationType: 'clarity'
        })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      
      const result = await response.json()
      
      // Validate response structure
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('metadata')
      
      expect(result.results[0]).toHaveProperty('originalFilename')
      expect(result.results[0]).toHaveProperty('optimizedContent')
      expect(result.results[0]).toHaveProperty('status')
      expect(result.results[0]).toHaveProperty('metadata')
      
      expect(result.metadata).toHaveProperty('documentsProcessed')
      expect(result.metadata).toHaveProperty('optimizationType')
      expect(result.metadata).toHaveProperty('timestamp')
    })
  })
})

// Helper function to check if server is running
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/optimize/health`, { timeout: 1000 })
    return response.ok
  } catch {
    return false
  }
}

// Skip tests if server is not running
if (process.env.VITEST_ENV !== 'e2e') {
  describe.skip('E2E tests skipped - set VITEST_ENV=e2e to run', () => {
    it('placeholder', () => {})
  })
}