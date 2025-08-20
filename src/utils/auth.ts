import type { FastifyRequest, FastifyReply } from 'fastify'
import type { JWTPayload } from '../types/index.js'

export interface AuthenticatedRequest extends FastifyRequest {
  jwtUser?: JWTPayload
}

export async function validateAPIKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] || request.headers['authorization']

  if (!apiKey) {
    return reply.code(401).send({
      error: 'API key required',
      code: 'MISSING_API_KEY',
      timestamp: new Date().toISOString()
    })
  }

  const validApiKey = process.env.API_KEY
  if (!validApiKey || apiKey !== validApiKey) {
    return reply.code(401).send({
      error: 'Invalid API key',
      code: 'INVALID_API_KEY',
      timestamp: new Date().toISOString()
    })
  }
}

export async function validateJWT(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const token = extractBearerToken(request.headers.authorization)

    if (!token) {
      return reply.code(401).send({
        error: 'JWT token required',
        code: 'MISSING_TOKEN',
        timestamp: new Date().toISOString()
      })
    }

    await request.jwtVerify()
  } catch (error) {
    return reply.code(401).send({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
      timestamp: new Date().toISOString()
    })
  }
}

export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null

  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1] || null
  }

  return null
}

export function generateMockJWT(userId: string, email?: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  )

  const payload: JWTPayload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')

  const signature = 'mock-signature'

  return `${header}.${encodedPayload}.${signature}`
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  async checkLimit(identifier: string): Promise<boolean> {
    const now = Date.now()
    const userRequests = this.requests.get(identifier) || []

    const recentRequests = userRequests.filter(
      (timestamp) => now - timestamp < this.windowMs
    )

    if (recentRequests.length >= this.maxRequests) {
      return false
    }

    recentRequests.push(now)
    this.requests.set(identifier, recentRequests)

    this.cleanup()

    return true
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.requests.entries()) {
      const recent = timestamps.filter((t) => now - t < this.windowMs)
      if (recent.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, recent)
      }
    }
  }

  getRemainingRequests(identifier: string): number {
    const now = Date.now()
    const userRequests = this.requests.get(identifier) || []
    const recentRequests = userRequests.filter(
      (timestamp) => now - timestamp < this.windowMs
    )
    return Math.max(0, this.maxRequests - recentRequests.length)
  }

  getResetTime(identifier: string): number {
    const userRequests = this.requests.get(identifier) || []
    if (userRequests.length === 0) return 0

    const oldestRequest = Math.min(...userRequests)
    return oldestRequest + this.windowMs
  }
}

export const rateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10)
)