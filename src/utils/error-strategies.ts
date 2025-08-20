import { ExternalServiceError, ValidationError, RateLimitError } from '../middleware/error-handler.js'

export interface ErrorContext {
  operation: string
  userId?: string
  documentId?: string
  model?: string
  retryCount?: number
  timestamp: Date
  metadata?: Record<string, any>
}

export interface ErrorRecoveryStrategy {
  canRecover: boolean
  recoveryAction?: () => Promise<void>
  fallbackValue?: any
  userMessage: string
  internalMessage: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export class ErrorStrategyManager {
  private errorHistory: Map<string, ErrorContext[]> = new Map()
  private recoveryStrategies: Map<string, ErrorRecoveryStrategy> = new Map()
  private readonly maxHistorySize = 100
  private readonly errorThresholds = {
    critical: 10,
    high: 25,
    medium: 50,
    low: 100
  }

  constructor() {
    this.initializeStrategies()
  }

  private initializeStrategies(): void {
    // OpenAI API errors
    this.recoveryStrategies.set('OPENAI_RATE_LIMIT', {
      canRecover: true,
      userMessage: 'Service is experiencing high demand. Please try again in a few moments.',
      internalMessage: 'OpenAI rate limit exceeded',
      severity: 'medium'
    })

    this.recoveryStrategies.set('OPENAI_TIMEOUT', {
      canRecover: true,
      userMessage: 'Request took too long to process. Retrying with a smaller document.',
      internalMessage: 'OpenAI request timeout',
      severity: 'medium'
    })

    this.recoveryStrategies.set('OPENAI_INVALID_KEY', {
      canRecover: false,
      userMessage: 'Authentication failed. Please check your API key.',
      internalMessage: 'Invalid OpenAI API key',
      severity: 'critical'
    })

    this.recoveryStrategies.set('OPENAI_SERVER_ERROR', {
      canRecover: true,
      userMessage: 'The AI service is temporarily unavailable. Please try again later.',
      internalMessage: 'OpenAI server error',
      severity: 'high'
    })

    // Document processing errors
    this.recoveryStrategies.set('DOCUMENT_TOO_LARGE', {
      canRecover: true,
      userMessage: 'Document is too large. Consider splitting it into smaller sections.',
      internalMessage: 'Document exceeds size limit',
      severity: 'low'
    })

    this.recoveryStrategies.set('DOCUMENT_INVALID_FORMAT', {
      canRecover: false,
      userMessage: 'Document format is not supported. Please use a supported format.',
      internalMessage: 'Invalid document format',
      severity: 'low'
    })

    this.recoveryStrategies.set('DOCUMENT_EMPTY', {
      canRecover: false,
      userMessage: 'Document appears to be empty or contains no readable content.',
      internalMessage: 'Empty document',
      severity: 'low'
    })

    // System errors
    this.recoveryStrategies.set('OUT_OF_MEMORY', {
      canRecover: true,
      userMessage: 'System resources temporarily unavailable. Please try again.',
      internalMessage: 'Out of memory error',
      severity: 'critical'
    })

    this.recoveryStrategies.set('CIRCUIT_BREAKER_OPEN', {
      canRecover: false,
      userMessage: 'Service is temporarily disabled due to multiple failures. Please try again later.',
      internalMessage: 'Circuit breaker is open',
      severity: 'high'
    })

    // Token/Budget errors
    this.recoveryStrategies.set('TOKEN_BUDGET_EXCEEDED', {
      canRecover: false,
      userMessage: 'You have exceeded your token budget. Please wait for the next billing period.',
      internalMessage: 'Token budget exceeded',
      severity: 'medium'
    })

    this.recoveryStrategies.set('DAILY_LIMIT_EXCEEDED', {
      canRecover: false,
      userMessage: 'Daily usage limit reached. Your limit will reset tomorrow.',
      internalMessage: 'Daily token limit exceeded',
      severity: 'low'
    })
  }

  analyzeError(error: Error, context: ErrorContext): ErrorRecoveryStrategy {
    // Record error in history
    this.recordError(error, context)

    // Determine error type and get strategy
    const errorType = this.classifyError(error)
    const strategy = this.recoveryStrategies.get(errorType) || this.getDefaultStrategy(error)

    // Check if we should escalate based on error frequency
    const escalation = this.checkEscalation(errorType, context)
    if (escalation) {
      strategy.severity = escalation.severity
      strategy.userMessage = escalation.userMessage
    }

    // Add recovery actions based on error type
    strategy.recoveryAction = this.getRecoveryAction(errorType, context)
    strategy.fallbackValue = this.getFallbackValue(errorType, context)

    return strategy
  }

  private classifyError(error: Error): string {
    if (error instanceof ExternalServiceError) {
      if (error.message.includes('Rate limit')) return 'OPENAI_RATE_LIMIT'
      if (error.message.includes('timeout')) return 'OPENAI_TIMEOUT'
      if (error.message.includes('Invalid API key')) return 'OPENAI_INVALID_KEY'
      if (error.message.includes('Server error')) return 'OPENAI_SERVER_ERROR'
      if (error.message.includes('Circuit breaker')) return 'CIRCUIT_BREAKER_OPEN'
    }

    if (error instanceof ValidationError) {
      if (error.message.includes('too large')) return 'DOCUMENT_TOO_LARGE'
      if (error.message.includes('not supported')) return 'DOCUMENT_INVALID_FORMAT'
      if (error.message.includes('empty')) return 'DOCUMENT_EMPTY'
    }

    if (error instanceof RateLimitError) {
      if (error.message.includes('daily')) return 'DAILY_LIMIT_EXCEEDED'
      if (error.message.includes('token budget')) return 'TOKEN_BUDGET_EXCEEDED'
      return 'OPENAI_RATE_LIMIT'
    }

    if (error.message.includes('out of memory')) return 'OUT_OF_MEMORY'
    if (error.message.includes('ENOMEM')) return 'OUT_OF_MEMORY'

    return 'UNKNOWN_ERROR'
  }

  private getDefaultStrategy(error: Error): ErrorRecoveryStrategy {
    return {
      canRecover: false,
      userMessage: 'An unexpected error occurred. Our team has been notified.',
      internalMessage: error.message,
      severity: 'medium'
    }
  }

  private recordError(error: Error, context: ErrorContext): void {
    const key = this.classifyError(error)
    
    if (!this.errorHistory.has(key)) {
      this.errorHistory.set(key, [])
    }

    const history = this.errorHistory.get(key)!
    history.push(context)

    // Maintain size limit
    if (history.length > this.maxHistorySize) {
      history.shift()
    }
  }

  private checkEscalation(errorType: string, context: ErrorContext): { severity: 'high' | 'critical', userMessage: string } | null {
    const history = this.errorHistory.get(errorType) || []
    const recentErrors = history.filter(h => 
      h.timestamp.getTime() > Date.now() - 3600000 // Last hour
    )

    if (recentErrors.length > this.errorThresholds.critical) {
      return {
        severity: 'critical',
        userMessage: 'This service is experiencing critical issues. Please contact support.'
      }
    }

    if (recentErrors.length > this.errorThresholds.high) {
      return {
        severity: 'high',
        userMessage: 'This service is experiencing significant issues. We are working to resolve them.'
      }
    }

    return null
  }

  private getRecoveryAction(errorType: string, context: ErrorContext): (() => Promise<void>) | undefined {
    switch (errorType) {
      case 'OPENAI_RATE_LIMIT':
        return async () => {
          // Wait for rate limit to reset
          await new Promise(resolve => setTimeout(resolve, 60000))
        }

      case 'DOCUMENT_TOO_LARGE':
        return async () => {
          // Could implement document splitting logic here
          console.log('Document splitting recovery action triggered')
        }

      case 'OUT_OF_MEMORY':
        return async () => {
          // Force garbage collection if available
          if (global.gc) {
            global.gc()
          }
        }

      default:
        return undefined
    }
  }

  private getFallbackValue(errorType: string, context: ErrorContext): any {
    switch (errorType) {
      case 'OPENAI_SERVER_ERROR':
      case 'OPENAI_TIMEOUT':
        return {
          optimizedContent: context.metadata?.originalContent || '',
          status: 'fallback',
          message: 'Using original content due to service unavailability'
        }

      case 'DOCUMENT_EMPTY':
        return {
          optimizedContent: '',
          status: 'empty',
          message: 'No content to optimize'
        }

      default:
        return undefined
    }
  }

  getErrorStats(): {
    totalErrors: number
    errorsByType: Record<string, number>
    errorsBySeverity: Record<string, number>
    recentErrors: ErrorContext[]
  } {
    const stats = {
      totalErrors: 0,
      errorsByType: {} as Record<string, number>,
      errorsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      recentErrors: [] as ErrorContext[]
    }

    for (const [type, history] of this.errorHistory.entries()) {
      stats.errorsByType[type] = history.length
      stats.totalErrors += history.length

      const strategy = this.recoveryStrategies.get(type)
      if (strategy) {
        stats.errorsBySeverity[strategy.severity] += history.length
      }

      // Get most recent errors
      stats.recentErrors.push(...history.slice(-5))
    }

    // Sort recent errors by timestamp
    stats.recentErrors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    stats.recentErrors = stats.recentErrors.slice(0, 20)

    return stats
  }

  clearHistory(): void {
    this.errorHistory.clear()
  }

  isServiceHealthy(serviceName: string): boolean {
    const criticalErrorTypes = [
      'OPENAI_INVALID_KEY',
      'CIRCUIT_BREAKER_OPEN',
      'OUT_OF_MEMORY'
    ]

    for (const errorType of criticalErrorTypes) {
      const history = this.errorHistory.get(errorType) || []
      const recentErrors = history.filter(h => 
        h.timestamp.getTime() > Date.now() - 300000 // Last 5 minutes
      )

      if (recentErrors.length > 3) {
        return false
      }
    }

    return true
  }
}

// Singleton instance
export const errorStrategyManager = new ErrorStrategyManager()

// Helper function for graceful degradation
export async function withGracefulDegradation<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  fallback?: T
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const strategy = errorStrategyManager.analyzeError(error as Error, context)

    // Log the error with appropriate severity
    console.error(`[${strategy.severity.toUpperCase()}] ${strategy.internalMessage}`, {
      context,
      error
    })

    // Try recovery if possible
    if (strategy.canRecover && strategy.recoveryAction) {
      try {
        await strategy.recoveryAction()
        return await operation() // Retry after recovery
      } catch (retryError) {
        console.error('Recovery failed:', retryError)
      }
    }

    // Use strategy fallback value if available
    if (strategy.fallbackValue !== undefined) {
      return strategy.fallbackValue
    }

    // Use provided fallback if available
    if (fallback !== undefined) {
      return fallback
    }

    // Re-throw with user-friendly message
    const userError = new Error(strategy.userMessage)
    ;(userError as any).originalError = error
    ;(userError as any).strategy = strategy
    throw userError
  }
}