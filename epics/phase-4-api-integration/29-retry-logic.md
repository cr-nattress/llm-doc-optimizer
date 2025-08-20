# User Story: Implement Retry Logic for OpenAI API Calls

## Story
As a reliability engineer, I want retry logic implemented for OpenAI API calls so that transient failures don't cause complete request failures and the system is resilient to network issues.

## Acceptance Criteria
- [ ] Exponential backoff is implemented
- [ ] Different retry strategies for different error types
- [ ] Maximum retry attempts are configurable
- [ ] Circuit breaker prevents cascading failures
- [ ] Retry attempts are logged

## Technical Details
Create src/utils/retry.ts:
```typescript
interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
}

interface RetryableError {
  isRetryable: boolean;
  shouldCircuitBreak: boolean;
}

export class RetryManager {
  private static readonly DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    exponentialBase: 2,
    jitter: true
  };
  
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 5;
  private readonly recoveryTimeout = 60000; // 1 minute
  
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const config = { ...RetryManager.DEFAULT_OPTIONS, ...options };
    
    // Check circuit breaker
    if (this.circuitBreakerState === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.circuitBreakerState = 'HALF_OPEN';
        console.log(`Circuit breaker half-open for ${context}`);
      } else {
        throw new Error(`Circuit breaker open for ${context}`);
      }
    }
    
    let lastError: Error;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await operation();
        
        // Success - reset circuit breaker
        if (this.circuitBreakerState === 'HALF_OPEN') {
          this.circuitBreakerState = 'CLOSED';
          this.failureCount = 0;
          console.log(`Circuit breaker closed for ${context}`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        const retryInfo = this.analyzeError(error);
        
        console.warn(`Attempt ${attempt}/${config.maxAttempts} failed for ${context}:`, {
          error: lastError.message,
          isRetryable: retryInfo.isRetryable
        });
        
        // Update circuit breaker state
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (retryInfo.shouldCircuitBreak && this.failureCount >= this.failureThreshold) {
          this.circuitBreakerState = 'OPEN';
          console.error(`Circuit breaker opened for ${context}`);
        }
        
        // Don't retry if not retryable or max attempts reached
        if (!retryInfo.isRetryable || attempt === config.maxAttempts) {
          break;
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt - 1, config);
        console.log(`Retrying ${context} in ${delay}ms...`);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }
  
  private analyzeError(error: unknown): RetryableError {
    // OpenAI-specific error handling
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as any).status;
      
      switch (status) {
        case 429: // Rate limit
          return { isRetryable: true, shouldCircuitBreak: false };
        case 500:
        case 502:
        case 503:
        case 504: // Server errors
          return { isRetryable: true, shouldCircuitBreak: true };
        case 401:
        case 403: // Auth errors
          return { isRetryable: false, shouldCircuitBreak: true };
        case 400: // Bad request
        case 404: // Not found
          return { isRetryable: false, shouldCircuitBreak: false };
        default:
          return { isRetryable: false, shouldCircuitBreak: false };
      }
    }
    
    // Network errors
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('timeout') || 
          message.includes('network') || 
          message.includes('enotfound') ||
          message.includes('econnrefused')) {
        return { isRetryable: true, shouldCircuitBreak: true };
      }
    }
    
    // Default: not retryable
    return { isRetryable: false, shouldCircuitBreak: false };
  }
  
  private calculateDelay(attempt: number, options: RetryOptions): number {
    const exponentialDelay = options.baseDelay * 
      Math.pow(options.exponentialBase, attempt);
    
    let delay = Math.min(exponentialDelay, options.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (options.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Get circuit breaker status
  getStatus() {
    return {
      state: this.circuitBreakerState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}
```

Update OpenAI service to use retry logic:
```typescript
// src/services/openai.service.ts
import { RetryManager } from '../utils/retry';

export class OpenAIService {
  private client: OpenAI;
  private retryManager = new RetryManager();
  
  // ... existing constructor ...
  
  async createCompletion(
    messages: ChatCompletionMessageParam[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } = {}
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const operation = async () => {
      const {
        model = 'gpt-4',
        temperature = 0.1,
        maxTokens = 4000,
        stream = false
      } = options;
      
      return await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
        user: 'document-optimizer'
      });
    };
    
    const context = `OpenAI ${options.model || 'gpt-4'} completion`;
    
    return this.retryManager.executeWithRetry(operation, context, {
      maxAttempts: 3,
      baseDelay: 2000,
      maxDelay: 30000
    });
  }
  
  // Add health check method
  async getCircuitBreakerStatus() {
    return this.retryManager.getStatus();
  }
}
```

Add monitoring endpoint:
```typescript
// In optimize.ts
app.get('/health/detailed', async (request, reply) => {
  const openaiStatus = await fastify.openai.getCircuitBreakerStatus();
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      openai: {
        circuitBreaker: openaiStatus.state,
        failureCount: openaiStatus.failureCount,
        healthy: openaiStatus.state !== 'OPEN'
      }
    }
  };
});
```

## Definition of Done
- [ ] Retry logic handles transient failures
- [ ] Circuit breaker prevents cascading failures
- [ ] Exponential backoff with jitter is implemented
- [ ] Different error types have appropriate retry strategies
- [ ] Monitoring endpoint shows retry status