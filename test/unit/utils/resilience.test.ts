import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResiliencePattern, Bulkhead, AdaptiveTimeout, HealthChecker } from '../../../src/utils/resilience.js'

describe('ResiliencePattern', () => {
  let resilience: ResiliencePattern

  beforeEach(() => {
    resilience = new ResiliencePattern({
      maxRetries: 2,
      retryDelay: 100,
      timeoutMs: 1000
    })
  })

  describe('executeWithResilience', () => {
    it('should execute operation successfully', async () => {
      const operation = async () => 'success'

      const result = await resilience.executeWithResilience(operation)
      expect(result).toBe('success')

      const metrics = resilience.getMetrics()
      expect(metrics.successfulRequests).toBe(1)
      expect(metrics.totalRequests).toBe(1)
    })

    it('should retry on retryable errors', async () => {
      let attempts = 0
      const operation = async () => {
        attempts++
        if (attempts === 1) {
          const error = new Error('Rate limit exceeded')
          ;(error as any).status = 429
          throw error
        }
        return 'success-after-retry'
      }

      const result = await resilience.executeWithResilience(operation)
      expect(result).toBe('success-after-retry')
      expect(attempts).toBe(2)

      const metrics = resilience.getMetrics()
      expect(metrics.retriedRequests).toBe(1)
    })

    it('should not retry non-retryable errors', async () => {
      let attempts = 0
      const operation = async () => {
        attempts++
        throw new Error('Non-retryable error')
      }

      try {
        await resilience.executeWithResilience(operation)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(attempts).toBe(1)
        expect(error.message).toBe('Non-retryable error')
      }
    })

    it('should use fallback on operation failure', async () => {
      const operation = async () => {
        throw new Error('Operation failed')
      }
      const fallback = async () => 'fallback-result'

      const result = await resilience.executeWithResilience(
        operation,
        fallback,
        'test-operation'
      )

      expect(result).toBe('fallback-result')

      const metrics = resilience.getMetrics()
      expect(metrics.fallbacksUsed).toBe(1)
    })

    it('should timeout long-running operations', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return 'should-not-reach'
      }

      try {
        await resilience.executeWithResilience(operation, undefined, 'timeout-test')
        expect.fail('Should have timed out')
      } catch (error) {
        expect(error.message).toContain('timed out')
      }

      const metrics = resilience.getMetrics()
      expect(metrics.timeouts).toBe(1)
    })

    it('should handle exponential backoff for retries', async () => {
      let attempts = 0
      const startTime = Date.now()
      const operation = async () => {
        attempts++
        if (attempts <= 2) {
          const error = new Error('Retryable error')
          ;(error as any).code = 'ECONNRESET'
          throw error
        }
        return 'success'
      }

      const result = await resilience.executeWithResilience(operation)
      const duration = Date.now() - startTime

      expect(result).toBe('success')
      expect(attempts).toBe(3)
      // Should take at least 100ms (first retry) + 200ms (second retry)
      expect(duration).toBeGreaterThanOrEqual(200)
    })
  })

  describe('metrics and health', () => {
    it('should track response times', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'success'
      }

      await resilience.executeWithResilience(operation)

      const metrics = resilience.getMetrics()
      expect(metrics.averageResponseTime).toBeGreaterThan(90)
    })

    it('should provide health status', async () => {
      // Execute some successful operations
      for (let i = 0; i < 5; i++) {
        await resilience.executeWithResilience(async () => 'success')
      }

      const health = resilience.getHealthStatus()
      expect(health.healthy).toBe(true)
      expect(health.successRate).toBe(1.0)
      expect(health.issues).toHaveLength(0)
    })

    it('should detect health issues', async () => {
      // Execute some failing operations
      for (let i = 0; i < 10; i++) {
        try {
          await resilience.executeWithResilience(async () => {
            throw new Error('Failure')
          })
        } catch {
          // Expected
        }
      }

      const health = resilience.getHealthStatus()
      expect(health.healthy).toBe(false)
      expect(health.successRate).toBe(0)
      expect(health.issues.length).toBeGreaterThan(0)
    })

    it('should reset metrics', () => {
      resilience.executeWithResilience(async () => 'success')
      
      let metrics = resilience.getMetrics()
      expect(metrics.totalRequests).toBe(1)

      resilience.resetMetrics()
      metrics = resilience.getMetrics()
      expect(metrics.totalRequests).toBe(0)
    })
  })
})

describe('Bulkhead', () => {
  let bulkhead: Bulkhead

  beforeEach(() => {
    bulkhead = new Bulkhead(2, 5) // Max 2 concurrent, queue size 5
  })

  it('should allow operations within concurrency limit', async () => {
    const results = await Promise.all([
      bulkhead.execute(async () => 'result1'),
      bulkhead.execute(async () => 'result2')
    ])

    expect(results).toEqual(['result1', 'result2'])
  })

  it('should queue operations exceeding concurrency limit', async () => {
    const operations = [
      bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'result1'
      }),
      bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'result2'
      }),
      bulkhead.execute(async () => 'result3'), // Should be queued
      bulkhead.execute(async () => 'result4')  // Should be queued
    ]

    const results = await Promise.all(operations)
    expect(results).toEqual(['result1', 'result2', 'result3', 'result4'])
  })

  it('should reject operations when queue is full', async () => {
    // Fill up active slots and queue
    const longRunningOps = Array.from({ length: 7 }, (_, i) =>
      bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return `result${i}`
      })
    )

    // This should be rejected due to full queue
    try {
      await bulkhead.execute(async () => 'should-fail')
      expect.fail('Should have been rejected')
    } catch (error) {
      expect(error.message).toContain('queue is full')
    }
  })

  it('should provide status information', async () => {
    const operation = bulkhead.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return 'result'
    })

    const status = bulkhead.getStatus()
    expect(status.activeRequests).toBe(1)
    expect(status.available).toBe(true)

    await operation
  })
})

describe('AdaptiveTimeout', () => {
  let adaptiveTimeout: AdaptiveTimeout

  beforeEach(() => {
    adaptiveTimeout = new AdaptiveTimeout(1000, 2)
  })

  it('should return base timeout initially', () => {
    expect(adaptiveTimeout.getTimeout()).toBe(1000)
  })

  it('should adapt timeout based on response times', () => {
    // Record some response times
    adaptiveTimeout.recordResponseTime(500)
    adaptiveTimeout.recordResponseTime(600)
    adaptiveTimeout.recordResponseTime(700)
    adaptiveTimeout.recordResponseTime(800)
    adaptiveTimeout.recordResponseTime(900)

    const timeout = adaptiveTimeout.getTimeout()
    expect(timeout).toBeGreaterThan(1000) // Should be higher than base
  })

  it('should not go below base timeout', () => {
    // Record very fast response times
    adaptiveTimeout.recordResponseTime(10)
    adaptiveTimeout.recordResponseTime(20)
    adaptiveTimeout.recordResponseTime(30)

    const timeout = adaptiveTimeout.getTimeout()
    expect(timeout).toBe(1000) // Should stay at base timeout
  })

  it('should reset response time history', () => {
    adaptiveTimeout.recordResponseTime(2000)
    expect(adaptiveTimeout.getTimeout()).toBeGreaterThan(1000)

    adaptiveTimeout.reset()
    expect(adaptiveTimeout.getTimeout()).toBe(1000)
  })
})

describe('HealthChecker', () => {
  let healthChecker: HealthChecker

  beforeEach(() => {
    healthChecker = new HealthChecker()
  })

  it('should register and run health checks', async () => {
    healthChecker.register('service1', async () => true)
    healthChecker.register('service2', async () => false)

    const results = await healthChecker.runChecks()

    expect(results.healthy).toBe(false)
    expect(results.checks.service1.healthy).toBe(true)
    expect(results.checks.service2.healthy).toBe(false)
  })

  it('should handle check failures', async () => {
    healthChecker.register('failing-check', async () => {
      throw new Error('Check failed')
    })

    const results = await healthChecker.runChecks()

    expect(results.healthy).toBe(false)
    expect(results.checks['failing-check'].healthy).toBe(false)
  })

  it('should provide individual health status', async () => {
    healthChecker.register('good-service', async () => true)
    healthChecker.register('bad-service', async () => false)

    await healthChecker.runChecks()

    expect(healthChecker.isHealthy('good-service')).toBe(true)
    expect(healthChecker.isHealthy('bad-service')).toBe(false)
    expect(healthChecker.isHealthy()).toBe(false) // Overall health
  })

  it('should get last results', async () => {
    healthChecker.register('test-service', async () => true)
    await healthChecker.runChecks()

    const lastResults = healthChecker.getLastResults()
    expect(lastResults['test-service']).toBeDefined()
    expect(lastResults['test-service'].healthy).toBe(true)
    expect(lastResults['test-service'].timestamp).toBeInstanceOf(Date)
  })
})