import type { FastifyRequest, FastifyReply } from 'fastify'
import type { JWTPayload } from '../types/index.js'
import { tokenManager } from '../services/token.service.js'

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

  const validApiKeys = process.env.API_KEYS?.split(',') || []
  if (validApiKeys.length === 0 || !validApiKeys.includes(apiKey as string)) {
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

export interface RateLimitInfo {
  allowed: boolean
  remaining: number
  resetTime: number
  limit: number
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private tokenUsage: Map<string, number[]> = new Map()
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly maxTokens: number

  constructor(
    maxRequests = 100, 
    windowMs = 60000, 
    maxTokens = 50000
  ) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.maxTokens = maxTokens
  }

  async checkLimit(identifier: string): Promise<RateLimitInfo> {
    const now = Date.now()
    const userRequests = this.requests.get(identifier) || []

    const recentRequests = userRequests.filter(
      (timestamp) => now - timestamp < this.windowMs
    )

    const allowed = recentRequests.length < this.maxRequests
    
    if (allowed) {
      recentRequests.push(now)
      this.requests.set(identifier, recentRequests)
      this.cleanup()
    }

    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - recentRequests.length),
      resetTime: this.getResetTime(identifier),
      limit: this.maxRequests
    }
  }

  async checkTokenLimit(identifier: string, tokens: number): Promise<RateLimitInfo> {
    const now = Date.now()
    const userTokens = this.tokenUsage.get(identifier) || []

    const recentTokens = userTokens.filter(
      (timestamp) => now - timestamp < this.windowMs
    )

    const currentTokenCount = recentTokens.length
    const allowed = currentTokenCount + tokens <= this.maxTokens
    
    if (allowed) {
      // Add token usage timestamps (one per token for simplicity)
      for (let i = 0; i < tokens; i++) {
        recentTokens.push(now)
      }
      this.tokenUsage.set(identifier, recentTokens)
    }

    return {
      allowed,
      remaining: Math.max(0, this.maxTokens - currentTokenCount),
      resetTime: this.getTokenResetTime(identifier),
      limit: this.maxTokens
    }
  }

  private cleanup(): void {
    const now = Date.now()
    
    // Cleanup request tracking
    for (const [key, timestamps] of this.requests.entries()) {
      const recent = timestamps.filter((t) => now - t < this.windowMs)
      if (recent.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, recent)
      }
    }

    // Cleanup token tracking
    for (const [key, timestamps] of this.tokenUsage.entries()) {
      const recent = timestamps.filter((t) => now - t < this.windowMs)
      if (recent.length === 0) {
        this.tokenUsage.delete(key)
      } else {
        this.tokenUsage.set(key, recent)
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

  getRemainingTokens(identifier: string): number {
    const now = Date.now()
    const userTokens = this.tokenUsage.get(identifier) || []
    const recentTokens = userTokens.filter(
      (timestamp) => now - timestamp < this.windowMs
    )
    return Math.max(0, this.maxTokens - recentTokens.length)
  }

  getResetTime(identifier: string): number {
    const userRequests = this.requests.get(identifier) || []
    if (userRequests.length === 0) return Date.now() + this.windowMs

    const oldestRequest = Math.min(...userRequests)
    return oldestRequest + this.windowMs
  }

  getTokenResetTime(identifier: string): number {
    const userTokens = this.tokenUsage.get(identifier) || []
    if (userTokens.length === 0) return Date.now() + this.windowMs

    const oldestToken = Math.min(...userTokens)
    return oldestToken + this.windowMs
  }

  getStats(): { requestCount: number, tokenCount: number, userCount: number } {
    let totalRequests = 0
    let totalTokens = 0
    
    for (const timestamps of this.requests.values()) {
      totalRequests += timestamps.length
    }
    
    for (const timestamps of this.tokenUsage.values()) {
      totalTokens += timestamps.length
    }

    return {
      requestCount: totalRequests,
      tokenCount: totalTokens,
      userCount: this.requests.size
    }
  }

  /**
   * Check both rate limits and token budgets
   */
  async checkLimitsAndBudget(
    identifier: string, 
    estimatedTokens: number = 1000,
    dailyTokenLimit?: number,
    monthlyTokenLimit?: number
  ): Promise<{
    allowed: boolean
    rateLimitInfo: RateLimitInfo
    budgetCheck?: {
      allowed: boolean
      reason?: string
      budget: any
    }
    reason?: string
  }> {
    // Check rate limits first
    const rateLimitInfo = await this.checkLimit(identifier)
    
    if (!rateLimitInfo.allowed) {
      return {
        allowed: false,
        rateLimitInfo,
        reason: 'Rate limit exceeded'
      }
    }

    // Check token budget
    const budgetCheck = tokenManager.checkBudgetLimits(
      identifier,
      estimatedTokens,
      dailyTokenLimit,
      monthlyTokenLimit
    )

    if (!budgetCheck.allowed) {
      return {
        allowed: false,
        rateLimitInfo,
        budgetCheck,
        reason: budgetCheck.reason
      }
    }

    return {
      allowed: true,
      rateLimitInfo,
      budgetCheck
    }
  }
}

export const rateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  parseInt(process.env.RATE_LIMIT_WINDOW || '3600000', 10), // 1 hour default
  parseInt(process.env.RATE_LIMIT_TOKENS || '50000', 10)
)