interface RetryOptions {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  exponentialBase: number
  jitter: boolean
}

interface RetryableError {
  isRetryable: boolean
  shouldCircuitBreak: boolean
}

export class RetryManager {
  private static readonly DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    exponentialBase: 2,
    jitter: true
  }
  
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failureCount = 0
  private lastFailureTime = 0
  private readonly failureThreshold = 5
  private readonly recoveryTimeout = 60000 // 1 minute
  
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const config = { ...RetryManager.DEFAULT_OPTIONS, ...options }
    
    // Check circuit breaker
    if (this.circuitBreakerState === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.circuitBreakerState = 'HALF_OPEN'
        console.log(`🔄 Circuit breaker half-open for ${context}`)
      } else {
        throw new Error(`⚡ Circuit breaker open for ${context}`)
      }
    }
    
    let lastError: Error | undefined
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        console.log(`🔄 Executing ${context} (attempt ${attempt}/${config.maxAttempts})`)
        const result = await operation()
        
        // Success - reset circuit breaker
        if (this.circuitBreakerState === 'HALF_OPEN') {
          this.circuitBreakerState = 'CLOSED'
          this.failureCount = 0
          console.log(`✅ Circuit breaker closed for ${context}`)
        }
        
        return result
      } catch (error) {
        lastError = error as Error
        const retryInfo = this.analyzeError(error)
        
        console.warn(`⚠️ Attempt ${attempt}/${config.maxAttempts} failed for ${context}:`, {
          error: lastError.message,
          isRetryable: retryInfo.isRetryable,
          shouldCircuitBreak: retryInfo.shouldCircuitBreak
        })
        
        // Update circuit breaker state
        this.failureCount++
        this.lastFailureTime = Date.now()
        
        if (retryInfo.shouldCircuitBreak && this.failureCount >= this.failureThreshold) {
          this.circuitBreakerState = 'OPEN'
          console.error(`🚨 Circuit breaker opened for ${context} (${this.failureCount} failures)`)
        }
        
        // Don't retry if not retryable or max attempts reached
        if (!retryInfo.isRetryable || attempt === config.maxAttempts) {
          break
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt - 1, config)
        console.log(`⏳ Retrying ${context} in ${delay}ms...`)
        
        await this.sleep(delay)
      }
    }
    
    throw lastError || new Error(`Operation failed after ${config.maxAttempts} attempts`)
  }
  
  private analyzeError(error: unknown): RetryableError {
    // OpenAI-specific error handling
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as any).status
      
      switch (status) {
        case 429: // Rate limit
          return { isRetryable: true, shouldCircuitBreak: false }
        case 500:
        case 502:
        case 503:
        case 504: // Server errors
          return { isRetryable: true, shouldCircuitBreak: true }
        case 401:
        case 403: // Auth errors
          return { isRetryable: false, shouldCircuitBreak: true }
        case 400: // Bad request
        case 404: // Not found
          return { isRetryable: false, shouldCircuitBreak: false }
        default:
          return { isRetryable: false, shouldCircuitBreak: false }
      }
    }
    
    // Network errors
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      if (message.includes('timeout') || 
          message.includes('network') || 
          message.includes('enotfound') ||
          message.includes('econnrefused') ||
          message.includes('socket hang up') ||
          message.includes('connection reset')) {
        return { isRetryable: true, shouldCircuitBreak: true }
      }
    }
    
    // Default: not retryable
    return { isRetryable: false, shouldCircuitBreak: false }
  }
  
  private calculateDelay(attempt: number, options: RetryOptions): number {
    const exponentialDelay = options.baseDelay * 
      Math.pow(options.exponentialBase, attempt)
    
    let delay = Math.min(exponentialDelay, options.maxDelay)
    
    // Add jitter to prevent thundering herd
    if (options.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5)
    }
    
    return Math.floor(delay)
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  // Get circuit breaker status
  getStatus() {
    return {
      state: this.circuitBreakerState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isHealthy: this.circuitBreakerState !== 'OPEN'
    }
  }

  // Reset circuit breaker (useful for testing or manual recovery)
  reset(): void {
    this.circuitBreakerState = 'CLOSED'
    this.failureCount = 0
    this.lastFailureTime = 0
    console.log('🔄 Circuit breaker manually reset')
  }
}