import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetryManager } from '../../../src/utils/retry.js'

describe('RetryManager', () => {
  let retryManager: RetryManager

  beforeEach(() => {
    retryManager = new RetryManager()
    vi.clearAllMocks()
  })

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success')
      
      const result = await retryManager.executeWithRetry(operation, 'test-operation')
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce({ status: 429, message: 'Rate limit exceeded' })
        .mockResolvedValue('success')
      
      const result = await retryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 3,
        baseDelay: 10 // Short delay for testing
      })
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 401, message: 'Unauthorized' })
      
      await expect(retryManager.executeWithRetry(operation, 'test-operation')).rejects.toThrow()
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should respect max attempts', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      
      await expect(retryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 3,
        baseDelay: 10
      })).rejects.toThrow()
      
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should implement exponential backoff', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
        .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
        .mockResolvedValue('success')

      const startTime = Date.now()
      
      const result = await retryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 3,
        baseDelay: 100,
        jitter: false // Disable jitter for predictable timing
      })
      
      const duration = Date.now() - startTime
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
      // Should have delays of ~100ms and ~200ms between attempts
      expect(duration).toBeGreaterThan(250)
    })

    it('should handle network errors as retryable', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValue('success')
      
      const result = await retryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 2,
        baseDelay: 10
      })
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit breaker after threshold failures', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      
      // Trigger multiple failures to exceed threshold
      for (let i = 0; i < 5; i++) {
        try {
          await retryManager.executeWithRetry(operation, 'test-operation', {
            maxAttempts: 1,
            baseDelay: 1
          })
        } catch {
          // Expected to fail
        }
      }
      
      const status = retryManager.getStatus()
      expect(status.state).toBe('OPEN')
      expect(status.failureCount).toBeGreaterThanOrEqual(5)
      expect(status.isHealthy).toBe(false)
    })

    it('should reject requests when circuit breaker is open', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      
      // Trigger failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await retryManager.executeWithRetry(operation, 'test-operation', {
            maxAttempts: 1,
            baseDelay: 1
          })
        } catch {
          // Expected to fail
        }
      }
      
      // Circuit breaker should now be open
      await expect(retryManager.executeWithRetry(operation, 'test-operation'))
        .rejects.toThrow('Circuit breaker open')
    })

    it('should reset circuit breaker manually', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      
      // Trigger failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await retryManager.executeWithRetry(operation, 'test-operation', {
            maxAttempts: 1,
            baseDelay: 1
          })
        } catch {
          // Expected to fail
        }
      }
      
      expect(retryManager.getStatus().state).toBe('OPEN')
      
      retryManager.reset()
      
      const status = retryManager.getStatus()
      expect(status.state).toBe('CLOSED')
      expect(status.failureCount).toBe(0)
      expect(status.isHealthy).toBe(true)
    })
  })

  describe('error analysis', () => {
    it('should classify rate limit errors as retryable without circuit breaking', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 429, message: 'Rate limit' })
      
      try {
        await retryManager.executeWithRetry(operation, 'test-operation', {
          maxAttempts: 2,
          baseDelay: 10
        })
      } catch {
        // Expected to fail after retries
      }
      
      // Should have retried
      expect(operation).toHaveBeenCalledTimes(2)
      
      // Circuit breaker should still be closed since 429 doesn't trigger it
      expect(retryManager.getStatus().state).toBe('CLOSED')
    })

    it('should classify auth errors as non-retryable but circuit breaking', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 401, message: 'Unauthorized' })
      
      try {
        await retryManager.executeWithRetry(operation, 'test-operation')
      } catch {
        // Expected to fail immediately
      }
      
      // Should not have retried
      expect(operation).toHaveBeenCalledTimes(1)
      
      // But should contribute to circuit breaker
      expect(retryManager.getStatus().failureCount).toBe(1)
    })

    it('should classify server errors as retryable and circuit breaking', async () => {
      const operation = vi.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      
      try {
        await retryManager.executeWithRetry(operation, 'test-operation', {
          maxAttempts: 2,
          baseDelay: 10
        })
      } catch {
        // Expected to fail after retries
      }
      
      // Should have retried
      expect(operation).toHaveBeenCalledTimes(2)
      
      // Should contribute to circuit breaker
      expect(retryManager.getStatus().failureCount).toBe(2)
    })
  })

  describe('delay calculation', () => {
    it('should calculate delay with jitter', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
        .mockResolvedValue('success')

      const delays: number[] = []
      const originalCalculateDelay = (retryManager as any).calculateDelay.bind(retryManager)
      
      vi.spyOn(retryManager as any, 'calculateDelay').mockImplementation((attempt: number, options: any) => {
        const delay = originalCalculateDelay(attempt, options)
        delays.push(delay)
        return delay
      })
      
      await retryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 2,
        baseDelay: 1000,
        jitter: true
      })
      
      expect(delays).toHaveLength(1)
      // With jitter, delay should be between 500ms and 1000ms
      expect(delays[0]).toBeGreaterThanOrEqual(500)
      expect(delays[0]).toBeLessThanOrEqual(1000)
    })

    it('should respect max delay', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
        .mockResolvedValue('success')

      // Create a fresh retry manager for this test to avoid interference
      const testRetryManager = new RetryManager()
      
      const result = await testRetryManager.executeWithRetry(operation, 'test-operation', {
        maxAttempts: 2,
        baseDelay: 10000,
        maxDelay: 5000,
        exponentialBase: 3,
        jitter: false
      })
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
      
      // Test the calculateDelay method directly
      const delay = (testRetryManager as any).calculateDelay(1, {
        baseDelay: 10000,
        maxDelay: 5000,
        exponentialBase: 3,
        jitter: false
      })
      
      expect(delay).toBeLessThanOrEqual(5000)
    })
  })
})