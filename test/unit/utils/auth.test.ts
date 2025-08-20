import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  validateAPIKey,
  validateJWT,
  extractBearerToken,
  generateMockJWT,
  RateLimiter
} from '../../../src/utils/auth.js'

describe('Authentication Utils', () => {
  describe('validateAPIKey', () => {
    it('should accept valid API key from x-api-key header', async () => {
      process.env.API_KEY = 'valid-key'
      
      const request = testHelpers.createMockRequest({
        headers: { 'x-api-key': 'valid-key' }
      })
      const reply = testHelpers.createMockReply()

      await validateAPIKey(request, reply)

      expect(reply.code).not.toHaveBeenCalled()
      expect(reply.send).not.toHaveBeenCalled()
    })

    it('should accept valid API key from authorization header', async () => {
      process.env.API_KEY = 'valid-key'
      
      const request = testHelpers.createMockRequest({
        headers: { authorization: 'valid-key' }
      })
      const reply = testHelpers.createMockReply()

      await validateAPIKey(request, reply)

      expect(reply.code).not.toHaveBeenCalled()
      expect(reply.send).not.toHaveBeenCalled()
    })

    it('should reject request without API key', async () => {
      const request = testHelpers.createMockRequest({
        headers: {}
      })
      const reply = testHelpers.createMockReply()

      await validateAPIKey(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'API key required',
          code: 'MISSING_API_KEY'
        })
      )
    })

    it('should reject invalid API key', async () => {
      process.env.API_KEY = 'valid-key'
      
      const request = testHelpers.createMockRequest({
        headers: { 'x-api-key': 'invalid-key' }
      })
      const reply = testHelpers.createMockReply()

      await validateAPIKey(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid API key',
          code: 'INVALID_API_KEY'
        })
      )
    })

    it('should handle missing environment variable', async () => {
      delete process.env.API_KEY
      
      const request = testHelpers.createMockRequest({
        headers: { 'x-api-key': 'any-key' }
      })
      const reply = testHelpers.createMockReply()

      await validateAPIKey(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
    })
  })

  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      
      const token = extractBearerToken(authHeader)

      expect(token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
    })

    it('should return null for invalid header format', () => {
      const authHeader = 'InvalidFormat token'
      
      const token = extractBearerToken(authHeader)

      expect(token).toBeNull()
    })

    it('should return null for missing header', () => {
      const token = extractBearerToken(undefined)

      expect(token).toBeNull()
    })

    it('should return null for Bearer without token', () => {
      const authHeader = 'Bearer'
      
      const token = extractBearerToken(authHeader)

      expect(token).toBeNull()
    })

    it('should handle Bearer with empty token', () => {
      const authHeader = 'Bearer '
      
      const token = extractBearerToken(authHeader)

      expect(token).toBeNull()
    })
  })

  describe('generateMockJWT', () => {
    it('should generate valid JWT structure', () => {
      const token = generateMockJWT('user123', 'user@example.com')

      const parts = token.split('.')
      expect(parts).toHaveLength(3) // header.payload.signature

      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString())
      expect(header).toMatchObject({
        alg: 'HS256',
        typ: 'JWT'
      })

      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
      expect(payload).toMatchObject({
        userId: 'user123',
        email: 'user@example.com',
        exp: expect.any(Number),
        iat: expect.any(Number)
      })
    })

    it('should generate token without email', () => {
      const token = generateMockJWT('user123')

      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
      
      expect(payload.userId).toBe('user123')
      expect(payload.email).toBeUndefined()
    })

    it('should set expiration in the future', () => {
      const token = generateMockJWT('user123')

      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
      
      const now = Math.floor(Date.now() / 1000)
      expect(payload.exp).toBeGreaterThan(now)
      expect(payload.iat).toBeLessThanOrEqual(now)
    })
  })

  describe('validateJWT', () => {
    it('should reject request without authorization header', async () => {
      const request = testHelpers.createMockRequest({
        headers: {}
      })
      const reply = testHelpers.createMockReply()

      await validateJWT(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'JWT token required',
          code: 'MISSING_TOKEN'
        })
      )
    })

    it('should reject invalid token format', async () => {
      const request = testHelpers.createMockRequest({
        headers: { authorization: 'Invalid token' }
      })
      const reply = testHelpers.createMockReply()

      await validateJWT(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
    })

    it('should handle JWT verification failure', async () => {
      const request = testHelpers.createMockRequest({
        headers: { authorization: 'Bearer invalid.jwt.token' },
        jwtVerify: vi.fn().mockRejectedValue(new Error('Invalid token'))
      })
      const reply = testHelpers.createMockReply()

      await validateJWT(request, reply)

      expect(reply.code).toHaveBeenCalledWith(401)
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        })
      )
    })

    it('should pass with valid JWT', async () => {
      const request = testHelpers.createMockRequest({
        headers: { authorization: 'Bearer valid.jwt.token' },
        jwtVerify: vi.fn().mockResolvedValue(true)
      })
      const reply = testHelpers.createMockReply()

      await validateJWT(request, reply)

      expect(request.jwtVerify).toHaveBeenCalled()
      expect(reply.code).not.toHaveBeenCalled()
    })
  })
})

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    rateLimiter = new RateLimiter(5, 1000) // 5 requests per second
  })

  describe('checkLimit', () => {
    it('should allow requests within limit', async () => {
      const identifier = 'user123'

      for (let i = 0; i < 5; i++) {
        const allowed = await rateLimiter.checkLimit(identifier)
        expect(allowed).toBe(true)
      }
    })

    it('should block requests exceeding limit', async () => {
      const identifier = 'user123'

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(identifier)
      }

      // Next request should be blocked
      const blocked = await rateLimiter.checkLimit(identifier)
      expect(blocked).toBe(false)
    })

    it('should allow requests after time window resets', async () => {
      const identifier = 'user123'

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(identifier)
      }

      // Wait for window to expire
      await testHelpers.wait(1100)

      // Should be allowed again
      const allowed = await rateLimiter.checkLimit(identifier)
      expect(allowed).toBe(true)
    })

    it('should handle different identifiers independently', async () => {
      const user1 = 'user1'
      const user2 = 'user2'

      // User1 uses up their limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(user1)
      }

      // User1 should be blocked
      expect(await rateLimiter.checkLimit(user1)).toBe(false)

      // User2 should still be allowed
      expect(await rateLimiter.checkLimit(user2)).toBe(true)
    })

    it('should track remaining requests correctly', async () => {
      const identifier = 'user123'

      expect(rateLimiter.getRemainingRequests(identifier)).toBe(5)

      await rateLimiter.checkLimit(identifier)
      expect(rateLimiter.getRemainingRequests(identifier)).toBe(4)

      await rateLimiter.checkLimit(identifier)
      expect(rateLimiter.getRemainingRequests(identifier)).toBe(3)
    })

    it('should calculate reset time correctly', async () => {
      const identifier = 'user123'
      const startTime = Date.now()

      await rateLimiter.checkLimit(identifier)
      
      const resetTime = rateLimiter.getResetTime(identifier)
      expect(resetTime).toBeGreaterThan(startTime)
      expect(resetTime).toBeLessThanOrEqual(startTime + 1000)
    })

    it('should handle cleanup of old entries', async () => {
      const identifier = 'user123'

      // Make a request
      await rateLimiter.checkLimit(identifier)

      // Wait for cleanup
      await testHelpers.wait(1100)

      // Make another request to trigger cleanup
      await rateLimiter.checkLimit(identifier)

      // Should have full limit available
      expect(rateLimiter.getRemainingRequests(identifier)).toBe(4)
    })
  })

  describe('configuration', () => {
    it('should respect custom limits', async () => {
      const customLimiter = new RateLimiter(2, 500) // 2 requests per 500ms
      const identifier = 'user123'

      expect(await customLimiter.checkLimit(identifier)).toBe(true)
      expect(await customLimiter.checkLimit(identifier)).toBe(true)
      expect(await customLimiter.checkLimit(identifier)).toBe(false)
    })

    it('should handle zero limit gracefully', async () => {
      const zeroLimiter = new RateLimiter(0, 1000)
      const identifier = 'user123'

      expect(await zeroLimiter.checkLimit(identifier)).toBe(false)
    })
  })
})