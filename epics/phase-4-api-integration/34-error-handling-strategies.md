# User Story: Add OpenAI Error Handling and Fallback Strategies

## Story
As a reliability engineer, I want comprehensive error handling for OpenAI API interactions so that the service remains available even when the AI provider has issues.

## Acceptance Criteria
- [ ] All OpenAI error types are handled appropriately
- [ ] Fallback strategies are implemented for different failure modes
- [ ] Degraded service modes are available
- [ ] Error recovery is automatic where possible
- [ ] Users receive helpful error messages

## Technical Details
Create comprehensive error handling:
```typescript
// src/utils/openai-errors.ts
import OpenAI from 'openai';

export enum OpenAIErrorType {
  RATE_LIMIT = 'rate_limit',
  QUOTA_EXCEEDED = 'quota_exceeded',
  MODEL_UNAVAILABLE = 'model_unavailable',
  CONTENT_FILTER = 'content_filter',
  CONTEXT_WINDOW = 'context_window',
  AUTHENTICATION = 'authentication',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

export interface OpenAIErrorDetails {
  type: OpenAIErrorType;
  originalError: any;
  retryable: boolean;
  retryAfter?: number;
  fallbackStrategy?: string;
  userMessage: string;
  technicalMessage: string;
}

export class OpenAIErrorHandler {
  static analyzeError(error: any): OpenAIErrorDetails {
    if (error instanceof OpenAI.APIError) {
      return this.handleAPIError(error);
    }
    
    if (error.code) {
      switch (error.code) {
        case 'ENOTFOUND':
        case 'ECONNREFUSED':
        case 'ETIMEDOUT':
          return {
            type: OpenAIErrorType.NETWORK_ERROR,
            originalError: error,
            retryable: true,
            fallbackStrategy: 'retry_with_backoff',
            userMessage: 'Network connection issue. Retrying...',
            technicalMessage: `Network error: ${error.message}`
          };
      }
    }
    
    if (error.message?.toLowerCase().includes('timeout')) {
      return {
        type: OpenAIErrorType.TIMEOUT,
        originalError: error,
        retryable: true,
        fallbackStrategy: 'retry_with_shorter_timeout',
        userMessage: 'Request timed out. Retrying with adjusted parameters...',
        technicalMessage: `Timeout error: ${error.message}`
      };
    }
    
    return {
      type: OpenAIErrorType.UNKNOWN,
      originalError: error,
      retryable: false,
      userMessage: 'An unexpected error occurred. Please try again later.',
      technicalMessage: `Unknown error: ${error.message || 'No details available'}`
    };
  }
  
  private static handleAPIError(error: OpenAI.APIError): OpenAIErrorDetails {
    switch (error.status) {
      case 429:
        return this.handleRateLimit(error);
      case 400:
        return this.handleBadRequest(error);
      case 401:
      case 403:
        return this.handleAuthError(error);
      case 404:
        return this.handleNotFound(error);
      case 413:
        return this.handlePayloadTooLarge(error);
      case 500:
      case 502:
      case 503:
      case 504:
        return this.handleServerError(error);
      default:
        return {
          type: OpenAIErrorType.UNKNOWN,
          originalError: error,
          retryable: false,
          userMessage: 'An API error occurred. Please try again later.',
          technicalMessage: `API error ${error.status}: ${error.message}`
        };
    }
  }
  
  private static handleRateLimit(error: OpenAI.APIError): OpenAIErrorDetails {
    const retryAfter = error.headers?.['retry-after'] ? 
      parseInt(error.headers['retry-after']) : 60;
    
    if (error.message?.includes('quota')) {
      return {
        type: OpenAIErrorType.QUOTA_EXCEEDED,
        originalError: error,
        retryable: false,
        userMessage: 'API quota exceeded. Service temporarily unavailable.',
        technicalMessage: 'OpenAI quota exceeded',
        fallbackStrategy: 'use_alternative_service'
      };
    }
    
    return {
      type: OpenAIErrorType.RATE_LIMIT,
      originalError: error,
      retryable: true,
      retryAfter,
      userMessage: `Rate limit exceeded. Retrying in ${retryAfter} seconds...`,
      technicalMessage: `Rate limited, retry after ${retryAfter}s`,
      fallbackStrategy: 'exponential_backoff'
    };
  }
  
  private static handleBadRequest(error: OpenAI.APIError): OpenAIErrorDetails {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('context_length_exceeded') || message.includes('too long')) {
      return {
        type: OpenAIErrorType.CONTEXT_WINDOW,
        originalError: error,
        retryable: true,
        userMessage: 'Document too large. Splitting into smaller chunks...',
        technicalMessage: 'Context window exceeded',
        fallbackStrategy: 'chunk_document'
      };
    }
    
    if (message.includes('content policy') || message.includes('safety')) {
      return {
        type: OpenAIErrorType.CONTENT_FILTER,
        originalError: error,
        retryable: false,
        userMessage: 'Content was filtered due to policy restrictions.',
        technicalMessage: 'Content policy violation',
        fallbackStrategy: 'sanitize_content'
      };
    }
    
    return {
      type: OpenAIErrorType.UNKNOWN,
      originalError: error,
      retryable: false,
      userMessage: 'Invalid request. Please check your input.',
      technicalMessage: `Bad request: ${error.message}`
    };
  }
  
  private static handleAuthError(error: OpenAI.APIError): OpenAIErrorDetails {
    return {
      type: OpenAIErrorType.AUTHENTICATION,
      originalError: error,
      retryable: false,
      userMessage: 'Service authentication error. Please contact support.',
      technicalMessage: 'OpenAI authentication failed',
      fallbackStrategy: 'check_api_key'
    };
  }
  
  private static handleNotFound(error: OpenAI.APIError): OpenAIErrorDetails {
    return {
      type: OpenAIErrorType.MODEL_UNAVAILABLE,
      originalError: error,
      retryable: true,
      userMessage: 'Requested AI model unavailable. Trying alternative...',
      technicalMessage: 'Model not found',
      fallbackStrategy: 'use_fallback_model'
    };
  }
  
  private static handlePayloadTooLarge(error: OpenAI.APIError): OpenAIErrorDetails {
    return {
      type: OpenAIErrorType.CONTEXT_WINDOW,
      originalError: error,
      retryable: true,
      userMessage: 'Document too large. Processing in smaller chunks...',
      technicalMessage: 'Payload too large',
      fallbackStrategy: 'chunk_document'
    };
  }
  
  private static handleServerError(error: OpenAI.APIError): OpenAIErrorDetails {
    return {
      type: OpenAIErrorType.SERVER_ERROR,
      originalError: error,
      retryable: true,
      retryAfter: 30,
      userMessage: 'AI service temporarily unavailable. Retrying...',
      technicalMessage: `OpenAI server error ${error.status}`,
      fallbackStrategy: 'retry_with_backoff'
    };
  }
}
```

Implement fallback strategies:
```typescript
// src/services/fallback.service.ts
export class FallbackService {
  constructor(
    private openaiService: OpenAIService,
    private tokenManager: TokenManager
  ) {}
  
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    context: string,
    fallbackStrategies: string[] = []
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const errorDetails = OpenAIErrorHandler.analyzeError(error);
      
      console.error(`Primary operation failed: ${context}`, {
        errorType: errorDetails.type,
        retryable: errorDetails.retryable,
        fallbackStrategy: errorDetails.fallbackStrategy
      });
      
      if (errorDetails.fallbackStrategy && 
          fallbackStrategies.includes(errorDetails.fallbackStrategy)) {
        
        return await this.executeFallbackStrategy(
          errorDetails.fallbackStrategy,
          operation,
          context,
          errorDetails
        );
      }
      
      throw new ApplicationError(
        errorDetails.userMessage,
        this.mapErrorTypeToStatusCode(errorDetails.type),
        errorDetails.type
      );
    }
  }
  
  private async executeFallbackStrategy<T>(
    strategy: string,
    originalOperation: () => Promise<T>,
    context: string,
    errorDetails: OpenAIErrorDetails
  ): Promise<T> {
    console.log(`Executing fallback strategy: ${strategy} for ${context}`);
    
    switch (strategy) {
      case 'retry_with_backoff':
        return await this.retryWithBackoff(originalOperation, errorDetails);
        
      case 'use_fallback_model':
        return await this.useAlternativeModel(originalOperation, context);
        
      case 'chunk_document':
        return await this.chunkAndProcess(originalOperation, context);
        
      case 'sanitize_content':
        return await this.sanitizeAndRetry(originalOperation, context);
        
      case 'use_alternative_service':
        return await this.useAlternativeService(originalOperation, context);
        
      case 'degraded_service':
        return await this.provideDegradedService(context);
        
      default:
        throw new Error(`Unknown fallback strategy: ${strategy}`);
    }
  }
  
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    errorDetails: OpenAIErrorDetails
  ): Promise<T> {
    const delay = errorDetails.retryAfter ? 
      errorDetails.retryAfter * 1000 : 
      5000; // 5 seconds default
    
    console.log(`Retrying operation in ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return await operation();
  }
  
  private async useAlternativeModel<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    // Extract model from context or use default fallback
    const currentModel = this.extractModelFromContext(context);
    const fallbackModel = this.getFallbackModel(currentModel);
    
    if (!fallbackModel) {
      throw new Error('No fallback model available');
    }
    
    console.log(`Falling back to model: ${fallbackModel}`);
    
    // This would require modifying the operation to use different model
    // Implementation depends on how the operation is structured
    return await operation(); // Would need to be modified for new model
  }
  
  private async chunkAndProcess<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    // This is complex and would need access to the original document
    // and the ability to recombine results
    throw new Error('Document chunking fallback not implemented');
  }
  
  private async sanitizeAndRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    // Would need access to original content to sanitize
    console.log('Content sanitization fallback not implemented');
    throw new Error('Content sanitization fallback not available');
  }
  
  private async useAlternativeService<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    // Could integrate with alternative AI services here
    throw new Error('Alternative service not configured');
  }
  
  private async provideDegradedService<T>(context: string): Promise<T> {
    // Return a simple, degraded response
    const degradedResponse = {
      originalFilename: 'unknown',
      optimizedContent: 'Service temporarily unavailable. Original document processing skipped.',
      metadata: {
        originalLength: 0,
        optimizedLength: 0,
        processingTime: 0,
        tokenCount: 0,
        model: 'degraded-service',
        entities: [],
        topics: []
      },
      status: 'fulfilled' as const,
      degraded: true
    };
    
    return degradedResponse as T;
  }
  
  private extractModelFromContext(context: string): string {
    const match = context.match(/OpenAI (\S+)/);
    return match ? match[1] : 'gpt-4';
  }
  
  private getFallbackModel(currentModel: string): string | null {
    const fallbackMap: Record<string, string> = {
      'gpt-4': 'gpt-3.5-turbo',
      'gpt-4-turbo': 'gpt-4',
      'gpt-4-32k': 'gpt-4',
      'gpt-3.5-turbo': 'gpt-3.5-turbo-instruct'
    };
    
    return fallbackMap[currentModel] || null;
  }
  
  private mapErrorTypeToStatusCode(errorType: OpenAIErrorType): number {
    switch (errorType) {
      case OpenAIErrorType.RATE_LIMIT:
        return 429;
      case OpenAIErrorType.QUOTA_EXCEEDED:
        return 503;
      case OpenAIErrorType.AUTHENTICATION:
        return 401;
      case OpenAIErrorType.CONTENT_FILTER:
        return 422;
      case OpenAIErrorType.CONTEXT_WINDOW:
        return 413;
      default:
        return 500;
    }
  }
}
```

Integrate fallback service into document processing:
```typescript
// Update DocumentService
export class DocumentService {
  private fallbackService: FallbackService;
  
  constructor(
    private openaiService: OpenAIService,
    private tokenManager: TokenManager
  ) {
    this.fallbackService = new FallbackService(openaiService, tokenManager);
  }
  
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string,
    options: any = {}
  ): Promise<OptimizationResult> {
    const operation = async () => {
      return await this.performOptimization(document, optimizationType, options);
    };
    
    return await this.fallbackService.executeWithFallback(
      operation,
      `Document optimization: ${document.name}`,
      [
        'retry_with_backoff',
        'use_fallback_model',
        'chunk_document',
        'degraded_service'
      ]
    );
  }
  
  private async performOptimization(
    document: DocumentInput,
    optimizationType: string,
    options: any
  ): Promise<OptimizationResult> {
    // Original optimization logic here
    // This method should now focus on the core logic
    // without error handling (that's handled by fallback service)
  }
}
```

Add error monitoring and alerting:
```typescript
// src/utils/error-monitor.ts
export class ErrorMonitor {
  private errorCounts = new Map<OpenAIErrorType, number>();
  private lastReset = Date.now();
  private readonly RESET_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  recordError(errorDetails: OpenAIErrorDetails) {
    // Reset counts periodically
    if (Date.now() - this.lastReset > this.RESET_INTERVAL) {
      this.errorCounts.clear();
      this.lastReset = Date.now();
    }
    
    const currentCount = this.errorCounts.get(errorDetails.type) || 0;
    this.errorCounts.set(errorDetails.type, currentCount + 1);
    
    // Check if we should alert
    if (this.shouldAlert(errorDetails.type, currentCount + 1)) {
      this.sendAlert(errorDetails, currentCount + 1);
    }
  }
  
  private shouldAlert(errorType: OpenAIErrorType, count: number): boolean {
    const thresholds: Record<OpenAIErrorType, number> = {
      [OpenAIErrorType.QUOTA_EXCEEDED]: 1,
      [OpenAIErrorType.AUTHENTICATION]: 1,
      [OpenAIErrorType.RATE_LIMIT]: 10,
      [OpenAIErrorType.SERVER_ERROR]: 5,
      [OpenAIErrorType.MODEL_UNAVAILABLE]: 3,
      [OpenAIErrorType.NETWORK_ERROR]: 10,
      [OpenAIErrorType.TIMEOUT]: 15,
      [OpenAIErrorType.CONTENT_FILTER]: 5,
      [OpenAIErrorType.CONTEXT_WINDOW]: 20,
      [OpenAIErrorType.UNKNOWN]: 5
    };
    
    return count >= (thresholds[errorType] || 5);
  }
  
  private async sendAlert(errorDetails: OpenAIErrorDetails, count: number) {
    console.error(`ALERT: High error rate detected`, {
      errorType: errorDetails.type,
      count,
      timeWindow: '1 hour',
      technicalMessage: errorDetails.technicalMessage
    });
    
    // Here you could integrate with alerting systems like:
    // - Sentry
    // - PagerDuty  
    // - Slack webhooks
    // - Email notifications
  }
  
  getErrorStats() {
    return {
      errors: Object.fromEntries(this.errorCounts),
      resetTime: this.lastReset,
      nextReset: this.lastReset + this.RESET_INTERVAL
    };
  }
}
```

## Definition of Done
- [ ] All OpenAI error types are handled appropriately
- [ ] Fallback strategies work for different failure modes
- [ ] Error monitoring tracks patterns and alerts
- [ ] Users receive helpful error messages
- [ ] Service remains available during AI provider issues