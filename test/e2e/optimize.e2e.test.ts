import { describe, it, expect } from 'vitest'
import type { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { handler } from '../../netlify/functions/optimize.js'

// E2E tests using function handler directly (no server required)
const API_KEY = 'test-api-key'

// Helper to create mock AWS Lambda event
const createMockEvent = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body: string | null = null
): APIGatewayProxyEvent => ({
  httpMethod: method,
  path,
  headers,
  body,
  queryStringParameters: null,
  pathParameters: null,
  requestContext: {} as any,
  resource: '',
  isBase64Encoded: false,
  multiValueHeaders: {},
  multiValueQueryStringParameters: null,
  stageVariables: null
})

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'optimize',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:optimize',
  memoryLimitInMB: '512',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/optimize',
  logStreamName: '2024/01/01/[$LATEST]abcd1234',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
}

describe('End-to-End Function Handler Tests', () => {
  describe('Health Check', () => {
    it('should return health status', async () => {
      const event = createMockEvent('GET', '/health')
      const response = await handler(event, mockContext)
      
      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        environment: 'development',
        version: '1.0.0'
      })
    })

    it('should return detailed health check', async () => {
      const event = createMockEvent('GET', '/health/detailed')
      const response = await handler(event, mockContext)
      
      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        services: {
          openai: {
            circuitBreaker: expect.any(String),
            failureCount: expect.any(Number),
            healthy: expect.any(Boolean)
          }
        }
      })
    })
  })

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          documents: [{ name: 'test.txt', content: 'test' }],
          optimizationType: 'clarity'
        })
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(401)
    })

    it('should accept requests with valid API key', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify({
          documents: [{ name: 'test.txt', content: 'Test content for optimization' }],
          optimizationType: 'clarity'
        })
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(200)
    })
  })

  describe('Endpoint Discovery', () => {
    it('should return endpoint information', async () => {
      const event = createMockEvent('GET', '/')
      const response = await handler(event, mockContext)
      
      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        name: 'LLM Document Optimizer',
        version: '1.0.0',
        endpoints: expect.arrayContaining([
          expect.stringContaining('health'),
          expect.stringContaining('optimize')
        ])
      })
    })

    it('should return available models', async () => {
      const event = createMockEvent('GET', '/models')
      const response = await handler(event, mockContext)
      
      expect(response.statusCode).toBe(200)
      
      const data = JSON.parse(response.body)
      expect(data).toMatchObject({
        models: expect.arrayContaining(['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo']),
        default: 'gpt-3.5-turbo'
      })
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

      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify(payload)
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(200)
      
      const result = JSON.parse(response.body)
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

    it('should handle consolidation requests', async () => {
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

      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify(payload)
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(200)
      
      const result = JSON.parse(response.body)
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].originalFilename).toBe('consolidated_document')
      expect(result.results[0].optimizedContent).toContain('Consolidated Document')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid JSON payload', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        '{ invalid json }'
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(400)
    })

    it('should handle missing documents', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify({
          optimizationType: 'clarity'
          // Missing documents field
        })
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(400)
      
      const result = JSON.parse(response.body)
      expect(result.error).toBeDefined()
    })

    it('should handle empty documents array', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify({
          documents: [],
          optimizationType: 'clarity'
        })
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(400)
    })

    it('should handle unsupported HTTP methods', async () => {
      const event = createMockEvent('PUT', '/optimize', { 'x-api-key': API_KEY })
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(404)
    })
  })

  describe('Response Format', () => {
    it('should return consistent response structure', async () => {
      const event = createMockEvent(
        'POST',
        '/optimize',
        {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        JSON.stringify({
          documents: [{
            name: 'test.txt',
            content: 'Test content',
            type: 'note'
          }],
          optimizationType: 'clarity'
        })
      )
      const response = await handler(event, mockContext)

      expect(response.statusCode).toBe(200)
      expect(response.headers).toHaveProperty('Content-Type')
      
      const result = JSON.parse(response.body)
      
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