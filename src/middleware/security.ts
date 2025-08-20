import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/environment.js'

// Security headers configuration
export const securityHeaders = {
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  
  // Force HTTPS (only in production with HTTPS enabled)
  ...(env.NODE_ENV === 'production' && env.FORCE_HTTPS && {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
  }),
  
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Allow inline scripts for development
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.openai.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  
  // Referrer Policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions Policy (Feature Policy)
  'Permissions-Policy': [
    'geolocation=()',
    'microphone=()',
    'camera=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()'
  ].join(', '),
  
  // Server identification
  'Server': 'LLM-Doc-Optimizer',
  
  // API version
  'X-API-Version': '1.0.0'
} as const

// Production-specific security headers
export const productionSecurityHeaders = {
  ...securityHeaders,
  
  // Stricter CSP for production
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  
  // Hide server information
  'Server': 'nginx',
  
  // Additional security headers
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-Download-Options': 'noopen',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site'
} as const

// Security middleware for Fastify
export async function registerSecurityMiddleware(fastify: FastifyInstance): Promise<void> {
  // Security headers hook
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    const headers = env.NODE_ENV === 'production' ? productionSecurityHeaders : securityHeaders
    
    Object.entries(headers).forEach(([key, value]) => {
      reply.header(key, value)
    })
  })

  // Rate limiting protection (if not already registered)
  if (!fastify.hasPlugin('@fastify/rate-limit')) {
    await fastify.register(import('@fastify/rate-limit'), {
      max: env.RATE_LIMIT_MAX,
      timeWindow: env.RATE_LIMIT_WINDOW_MS,
      errorResponseBuilder: (request, context) => ({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Maximum ${context.max} requests per ${Math.floor(env.RATE_LIMIT_WINDOW_MS / 60000)} minutes.`,
        retryAfter: Math.ceil((context as any).ttl / 1000)
      })
    })
  }

  // Helmet-like security
  try {
    await fastify.register(import('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: env.NODE_ENV === 'development' 
          ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
          : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: env.NODE_ENV === 'production' ? { policy: 'require-corp' } : false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.NODE_ENV === 'production' && env.FORCE_HTTPS ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    } : false,
    noSniff: true,
    originAgentCluster: true,
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    ieNoOpen: true,
    permittedCrossDomainPolicies: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true
  })
  } catch (error) {
    console.warn('Failed to register helmet middleware:', error)
  }

  // HTTPS redirect middleware (for production)
  if (env.NODE_ENV === 'production' && env.FORCE_HTTPS) {
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const forwardedProto = request.headers['x-forwarded-proto']
      const isSecure = request.protocol === 'https' || forwardedProto === 'https'
      
      if (!isSecure) {
        const host = request.headers.host || 'localhost'
        const httpsUrl = `https://${host}${request.url}`
        reply.redirect(httpsUrl, 301)
        return
      }
    })
  }

  // Input validation and sanitization
  fastify.addHook('preValidation', async (request: FastifyRequest) => {
    // Validate content length
    const contentLength = request.headers['content-length']
    if (contentLength && parseInt(contentLength) > env.MAX_FILE_SIZE) {
      throw new Error(`Request too large. Maximum size is ${env.MAX_FILE_SIZE} bytes`)
    }

    // Validate content type for file uploads
    if (request.headers['content-type']?.includes('multipart/form-data')) {
      const boundary = request.headers['content-type'].split('boundary=')[1]
      if (!boundary || boundary.length > 256) {
        throw new Error('Invalid multipart boundary')
      }
    }

    // Basic header validation
    const userAgent = request.headers['user-agent']
    if (userAgent && userAgent.length > 1000) {
      throw new Error('Invalid user agent header')
    }
  })

  // Request timeout
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const timeout = setTimeout(() => {
      reply.code(408).send({
        error: 'Request Timeout',
        message: 'Request took too long to process'
      })
    }, env.MAX_REQUEST_TIMEOUT)

    reply.raw.on('finish', () => clearTimeout(timeout))
    reply.raw.on('close', () => clearTimeout(timeout))
  })
}

// CORS configuration
export function getCORSOptions() {
  return {
    // Allow all origins for testing and single-user deployment
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cache-Control',
      'X-File-Name'
    ],
    credentials: false,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
  }
}

// API Key validation middleware
export function createAPIKeyValidator(validApiKeys: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string
    
    if (!apiKey) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'API key is required'
      })
      return
    }

    if (!validApiKeys.includes(apiKey)) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key'
      })
      return
    }
  }
}

// JWT validation middleware
export function createJWTValidator() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      })
    }
  }
}

// Security audit logging
export function logSecurityEvent(
  event: string,
  details: Record<string, any>,
  request?: FastifyRequest
) {
  const logData = {
    timestamp: new Date().toISOString(),
    event,
    details,
    ip: request?.ip,
    userAgent: request?.headers['user-agent'],
    url: request?.url,
    method: request?.method
  }

  if (env.NODE_ENV === 'production') {
    // In production, send to monitoring service
    console.warn('[SECURITY]', JSON.stringify(logData))
  } else {
    console.log('[SECURITY]', logData)
  }
}

// Sanitize sensitive data from logs
export function sanitizeForLogging(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data
  }

  const sensitiveKeys = [
    'password', 'secret', 'token', 'key', 'authorization',
    'x-api-key', 'openai', 'jwt', 'auth', 'credential'
  ]

  const sanitized = Array.isArray(data) ? [] : {}

  for (const [key, value] of Object.entries(data)) {
    const lowercaseKey = key.toLowerCase()
    const isSensitive = sensitiveKeys.some(sensitive => 
      lowercaseKey.includes(sensitive)
    )

    if (isSensitive) {
      (sanitized as any)[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      (sanitized as any)[key] = sanitizeForLogging(value)
    } else {
      (sanitized as any)[key] = value
    }
  }

  return sanitized
}