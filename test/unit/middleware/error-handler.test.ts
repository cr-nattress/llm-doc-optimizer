import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  errorHandler,
  createErrorResponse,
  notFoundHandler,
  isOperationalError,
  logError
} from '../../../src/middleware/error-handler.js'

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with default values', () => {
      const error = new AppError('Test error')

      expect(error.message).toBe('Test error')
      expect(error.statusCode).toBe(500)
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.isOperational).toBe(true)
      expect(error.name).toBe('Error')
    })

    it('should create error with custom values', () => {
      const error = new AppError('Custom error', 400, 'CUSTOM_CODE', false)

      expect(error.message).toBe('Custom error')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('CUSTOM_CODE')
      expect(error.isOperational).toBe(false)
    })
  })

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid input')

      expect(error.message).toBe('Invalid input')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.isOperational).toBe(true)
    })

    it('should include details', () => {
      const details = { field: 'email', reason: 'invalid format' }
      const error = new ValidationError('Invalid input', details)

      expect((error as any).details).toEqual(details)
    })
  })

  describe('AuthenticationError', () => {
    it('should create auth error with default message', () => {
      const error = new AuthenticationError()

      expect(error.message).toBe('Authentication failed')
      expect(error.statusCode).toBe(401)
      expect(error.code).toBe('AUTH_ERROR')
    })

    it('should create auth error with custom message', () => {
      const error = new AuthenticationError('Token expired')

      expect(error.message).toBe('Token expired')
    })
  })

  describe('AuthorizationError', () => {
    it('should create authz error with default message', () => {
      const error = new AuthorizationError()

      expect(error.message).toBe('Insufficient permissions')
      expect(error.statusCode).toBe(403)
      expect(error.code).toBe('AUTHZ_ERROR')
    })
  })

  describe('NotFoundError', () => {
    it('should create not found error with default resource', () => {
      const error = new NotFoundError()

      expect(error.message).toBe('Resource not found')
      expect(error.statusCode).toBe(404)
      expect(error.code).toBe('NOT_FOUND')
    })

    it('should create not found error with custom resource', () => {
      const error = new NotFoundError('Document')

      expect(error.message).toBe('Document not found')
    })
  })

  describe('RateLimitError', () => {
    it('should create rate limit error', () => {
      const error = new RateLimitError()

      expect(error.message).toBe('Too many requests')
      expect(error.statusCode).toBe(429)
      expect(error.code).toBe('RATE_LIMIT')
    })
  })

  describe('ExternalServiceError', () => {
    it('should create external service error', () => {
      const error = new ExternalServiceError('OpenAI')

      expect(error.message).toBe('External service error: OpenAI')
      expect(error.statusCode).toBe(503)
      expect(error.code).toBe('EXTERNAL_SERVICE_ERROR')
    })

    it('should include original error', () => {
      const originalError = new Error('Network timeout')
      const error = new ExternalServiceError('OpenAI', originalError)

      expect((error as any).originalError).toBe(originalError)
    })
  })
})

describe('Error Handler Middleware', () => {
  let mockRequest: any
  let mockReply: any
  let mockLogger: any

  beforeEach(() => {
    mockLogger = {
      error: vi.fn()
    }

    mockRequest = {
      method: 'POST',
      url: '/optimize',
      headers: { 'x-api-key': 'test-key' },
      body: { test: 'data' },
      server: { log: mockLogger }
    }

    mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    }
  })

  describe('AppError handling', () => {
    it('should handle operational AppError', async () => {
      const error = new ValidationError('Invalid input', { field: 'email' })

      await errorHandler(error, mockRequest, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(400)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: { field: 'email' },
        timestamp: expect.any(String)
      })
    })

    it('should log non-operational AppError', async () => {
      const error = new AppError('Critical error', 500, 'CRITICAL', false)

      await errorHandler(error, mockRequest, mockReply)

      expect(mockLogger.error).toHaveBeenCalled()
      expect(mockReply.code).toHaveBeenCalledWith(500)
    })
  })

  describe('Fastify validation error handling', () => {
    it('should handle Fastify validation errors', async () => {
      const error = {
        validation: [
          { instancePath: '/email', message: 'must be email' }
        ]
      } as any

      await errorHandler(error, mockRequest, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(400)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Request validation failed',
        code: 'VALIDATION_ERROR',
        details: error.validation,
        timestamp: expect.any(String)
      })
    })
  })

  describe('Fastify error handling', () => {
    it('should handle Fastify errors with status code', async () => {
      const error = {
        statusCode: 422,
        message: 'Unprocessable Entity',
        code: 'FASTIFY_ERROR'
      } as any

      await errorHandler(error, mockRequest, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(422)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Unprocessable Entity',
        code: 'FASTIFY_ERROR',
        timestamp: expect.any(String)
      })
    })
  })

  describe('Generic error handling', () => {
    it('should handle unknown errors in development', async () => {
      process.env.NODE_ENV = 'development'
      const error = new Error('Unknown error')
      error.stack = 'Error stack trace'

      await errorHandler(error, mockRequest, mockReply)

      expect(mockLogger.error).toHaveBeenCalled()
      expect(mockReply.code).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Unknown error',
        code: 'INTERNAL_ERROR',
        details: { stack: 'Error stack trace' },
        timestamp: expect.any(String)
      })
    })

    it('should handle unknown errors in production', async () => {
      process.env.NODE_ENV = 'production'
      const error = new Error('Unknown error')

      await errorHandler(error, mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: expect.any(String)
      })
    })
  })
})

describe('Not Found Handler', () => {
  it('should handle 404 requests', async () => {
    const mockRequest = {
      method: 'GET',
      url: '/non-existent'
    } as any

    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    } as any

    await notFoundHandler(mockRequest, mockReply)

    expect(mockReply.code).toHaveBeenCalledWith(404)
    expect(mockReply.send).toHaveBeenCalledWith({
      error: 'Route GET /non-existent not found',
      code: 'ROUTE_NOT_FOUND',
      timestamp: expect.any(String)
    })
  })
})

describe('Utility Functions', () => {
  describe('createErrorResponse', () => {
    it('should create error response without details', () => {
      const response = createErrorResponse('Test error', 'TEST_CODE', 400)

      expect(response).toEqual({
        error: 'Test error',
        code: 'TEST_CODE',
        timestamp: expect.any(String)
      })
    })

    it('should create error response with details', () => {
      const details = { field: 'email' }
      const response = createErrorResponse('Test error', 'TEST_CODE', 400, details)

      expect(response).toEqual({
        error: 'Test error',
        code: 'TEST_CODE',
        details,
        timestamp: expect.any(String)
      })
    })
  })

  describe('isOperationalError', () => {
    it('should return true for operational AppError', () => {
      const error = new ValidationError('Test error')

      expect(isOperationalError(error)).toBe(true)
    })

    it('should return false for non-operational AppError', () => {
      const error = new AppError('Test error', 500, 'TEST', false)

      expect(isOperationalError(error)).toBe(false)
    })

    it('should return false for regular Error', () => {
      const error = new Error('Regular error')

      expect(isOperationalError(error)).toBe(false)
    })
  })

  describe('logError', () => {
    const originalConsoleError = console.error

    beforeEach(() => {
      console.error = vi.fn()
    })

    afterEach(() => {
      console.error = originalConsoleError
    })

    it('should log error with context', () => {
      const error = new Error('Test error')
      const context = { userId: '123', operation: 'optimize' }

      logError(error, context)

      expect(console.error).toHaveBeenCalledWith('Error occurred:', {
        message: 'Test error',
        stack: expect.any(String),
        name: 'Error',
        userId: '123',
        operation: 'optimize',
        timestamp: expect.any(String)
      })
    })

    it('should log error without context', () => {
      const error = new Error('Test error')

      logError(error)

      expect(console.error).toHaveBeenCalledWith('Error occurred:', {
        message: 'Test error',
        stack: expect.any(String),
        name: 'Error',
        timestamp: expect.any(String)
      })
    })
  })
})