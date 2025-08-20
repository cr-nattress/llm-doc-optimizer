import { EventEmitter } from 'events'

export interface ResilienceConfig {
  maxRetries?: number
  retryDelay?: number
  circuitBreakerThreshold?: number
  circuitBreakerTimeout?: number
  timeoutMs?: number
  fallbackEnabled?: boolean
}

export interface ResilienceMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  retriedRequests: number
  circuitBreakerTrips: number
  timeouts: number
  fallbacksUsed: number
  averageResponseTime: number
}

export class ResiliencePattern extends EventEmitter {
  private metrics: ResilienceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriedRequests: 0,
    circuitBreakerTrips: 0,
    timeouts: 0,
    fallbacksUsed: 0,
    averageResponseTime: 0
  }

  private responseTimes: number[] = []
  private readonly maxResponseTimeSamples = 100

  constructor(private config: ResilienceConfig = {}) {
    super()
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 30000,
      timeoutMs: 30000,
      fallbackEnabled: true,
      ...config
    }
  }

  async executeWithResilience<T>(
    operation: () => Promise<T>,
    fallback?: () => T | Promise<T>,
    operationName: string = 'operation'
  ): Promise<T> {
    const startTime = Date.now()
    this.metrics.totalRequests++

    try {
      // Add timeout wrapper
      const result = await this.withTimeout(
        this.withRetry(operation, operationName),
        operationName
      )

      this.recordSuccess(startTime)
      return result
    } catch (error) {
      this.recordFailure(startTime)

      if (this.config.fallbackEnabled && fallback) {
        this.metrics.fallbacksUsed++
        this.emit('fallback', { operationName, error })
        return await fallback()
      }

      throw error
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          this.metrics.timeouts++
          this.emit('timeout', { operationName })
          reject(new Error(`Operation ${operationName} timed out after ${this.config.timeoutMs}ms`))
        }, this.config.timeoutMs)
      })
    ])
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined
    
    for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
      try {
        if (attempt > 0) {
          this.metrics.retriedRequests++
          await this.delay(this.config.retryDelay! * Math.pow(2, attempt - 1))
          this.emit('retry', { operationName, attempt })
        }

        return await operation()
      } catch (error) {
        lastError = error as Error
        
        if (attempt === this.config.maxRetries) {
          break
        }

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error
        }
      }
    }

    throw lastError
  }

  private isRetryable(error: any): boolean {
    // Network errors
    if (error.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
      return true
    }

    // HTTP status codes that are retryable
    if (error.status && [429, 502, 503, 504].includes(error.status)) {
      return true
    }

    // Rate limit errors
    if (error.message && error.message.toLowerCase().includes('rate limit')) {
      return true
    }

    return false
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private recordSuccess(startTime: number): void {
    this.metrics.successfulRequests++
    this.recordResponseTime(Date.now() - startTime)
  }

  private recordFailure(startTime: number): void {
    this.metrics.failedRequests++
    this.recordResponseTime(Date.now() - startTime)
  }

  private recordResponseTime(duration: number): void {
    this.responseTimes.push(duration)
    
    if (this.responseTimes.length > this.maxResponseTimeSamples) {
      this.responseTimes.shift()
    }

    this.metrics.averageResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
  }

  getMetrics(): ResilienceMetrics {
    return { ...this.metrics }
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      circuitBreakerTrips: 0,
      timeouts: 0,
      fallbacksUsed: 0,
      averageResponseTime: 0
    }
    this.responseTimes = []
  }

  getHealthStatus(): {
    healthy: boolean
    successRate: number
    averageResponseTime: number
    issues: string[]
  } {
    const successRate = this.metrics.totalRequests > 0
      ? this.metrics.successfulRequests / this.metrics.totalRequests
      : 1

    const issues: string[] = []

    if (successRate < 0.95) {
      issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`)
    }

    if (this.metrics.timeouts > 5) {
      issues.push(`High timeout count: ${this.metrics.timeouts}`)
    }

    if (this.metrics.averageResponseTime > 5000) {
      issues.push(`Slow response time: ${this.metrics.averageResponseTime.toFixed(0)}ms`)
    }

    if (this.metrics.circuitBreakerTrips > 0) {
      issues.push(`Circuit breaker tripped ${this.metrics.circuitBreakerTrips} times`)
    }

    return {
      healthy: issues.length === 0,
      successRate,
      averageResponseTime: this.metrics.averageResponseTime,
      issues
    }
  }
}

// Bulkhead pattern for isolating resources
export class Bulkhead {
  private activeRequests = 0
  private queue: Array<{ resolve: Function; reject: Function }> = []

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueueSize: number = 100
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrency) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new Error('Bulkhead queue is full')
      }

      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject })
      })
    }

    this.activeRequests++

    try {
      return await operation()
    } finally {
      this.activeRequests--
      
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        next?.resolve()
      }
    }
  }

  getStatus(): {
    activeRequests: number
    queueLength: number
    available: boolean
  } {
    return {
      activeRequests: this.activeRequests,
      queueLength: this.queue.length,
      available: this.activeRequests < this.maxConcurrency
    }
  }
}

// Adaptive timeout based on response times
export class AdaptiveTimeout {
  private responseTimes: number[] = []
  private readonly maxSamples = 50

  constructor(
    private baseTimeout: number = 30000,
    private readonly multiplier: number = 2
  ) {}

  recordResponseTime(duration: number): void {
    this.responseTimes.push(duration)
    
    if (this.responseTimes.length > this.maxSamples) {
      this.responseTimes.shift()
    }
  }

  getTimeout(): number {
    if (this.responseTimes.length === 0) {
      return this.baseTimeout
    }

    // Calculate 95th percentile
    const sorted = [...this.responseTimes].sort((a, b) => a - b)
    const index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[index] || sorted[sorted.length - 1]

    // Adaptive timeout is p95 * multiplier, but not less than base timeout
    return Math.max(this.baseTimeout, p95! * this.multiplier)
  }

  reset(): void {
    this.responseTimes = []
  }
}

// Health check manager
export class HealthChecker {
  private checks: Map<string, () => Promise<boolean>> = new Map()
  private lastResults: Map<string, { healthy: boolean; timestamp: Date }> = new Map()

  register(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check)
  }

  async runChecks(): Promise<{
    healthy: boolean
    checks: Record<string, { healthy: boolean; timestamp: Date }>
  }> {
    const results: Record<string, { healthy: boolean; timestamp: Date }> = {}
    let allHealthy = true

    for (const [name, check] of this.checks.entries()) {
      try {
        const healthy = await check()
        const result = { healthy, timestamp: new Date() }
        
        results[name] = result
        this.lastResults.set(name, result)
        
        if (!healthy) {
          allHealthy = false
        }
      } catch (error) {
        const result = { healthy: false, timestamp: new Date() }
        
        results[name] = result
        this.lastResults.set(name, result)
        allHealthy = false
      }
    }

    return { healthy: allHealthy, checks: results }
  }

  getLastResults(): Record<string, { healthy: boolean; timestamp: Date }> {
    const results: Record<string, { healthy: boolean; timestamp: Date }> = {}
    
    for (const [name, result] of this.lastResults.entries()) {
      results[name] = result
    }
    
    return results
  }

  isHealthy(checkName?: string): boolean {
    if (checkName) {
      return this.lastResults.get(checkName)?.healthy || false
    }

    for (const result of this.lastResults.values()) {
      if (!result.healthy) {
        return false
      }
    }

    return true
  }
}

// Create singleton instances
export const resiliencePattern = new ResiliencePattern()
export const healthChecker = new HealthChecker()
export const adaptiveTimeout = new AdaptiveTimeout()