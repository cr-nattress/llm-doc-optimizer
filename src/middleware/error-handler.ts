import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import type { ErrorResponse } from '../types/index.js'

export class AppError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly isOperational: boolean

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    isOperational = true
  ) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.isOperational = isOperational

    Object.setPrototypeOf(this, AppError.prototype)
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR')
    if (details) {
      ;(this as any).details = details
    }
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTH_ERROR')
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHZ_ERROR')
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND')
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT')
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(`External service error: ${service}`, 503, 'EXTERNAL_SERVICE_ERROR')
    if (originalError) {
      ;(this as any).originalError = originalError
    }
  }
}

export async function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const logger = request.server.log

  if (error instanceof AppError) {
    if (!error.isOperational) {
      logger.error(
        {
          err: error,
          request: {
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: request.body
          }
        },
        'Operational error occurred'
      )
    }

    const response: ErrorResponse = {
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    }

    if ((error as any).details) {
      response.details = (error as any).details
    }

    return reply.code(error.statusCode).send(response)
  }

  if ('validation' in error) {
    const response: ErrorResponse = {
      error: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details: error.validation,
      timestamp: new Date().toISOString()
    }

    return reply.code(400).send(response)
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    const response: ErrorResponse = {
      error: error.message || 'An error occurred',
      code: (error as any).code || 'FASTIFY_ERROR',
      timestamp: new Date().toISOString()
    }

    return reply.code(error.statusCode).send(response)
  }

  logger.error(
    {
      err: error,
      request: {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body
      }
    },
    'Unhandled error occurred'
  )

  const response: ErrorResponse = {
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message || 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  }

  if (process.env.NODE_ENV !== 'production' && error.stack) {
    response.details = { stack: error.stack }
  }

  return reply.code(500).send(response)
}

export function createErrorResponse(
  message: string,
  code: string,
  statusCode: number,
  details?: unknown
): ErrorResponse {
  const response: ErrorResponse = {
    error: message,
    code,
    timestamp: new Date().toISOString()
  }

  if (details) {
    response.details = details
  }

  return response
}

export async function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const response: ErrorResponse = {
    error: `Route ${request.method} ${request.url} not found`,
    code: 'ROUTE_NOT_FOUND',
    timestamp: new Date().toISOString()
  }

  return reply.code(404).send(response)
}

export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational
  }
  return false
}

export function logError(
  error: Error,
  context?: Record<string, unknown>
): void {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context,
    timestamp: new Date().toISOString()
  })
}