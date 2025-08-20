import type { ErrorContext, ErrorRecoveryStrategy } from './error-strategies.js'

export interface ErrorReport {
  id: string
  timestamp: Date
  error: {
    name: string
    message: string
    stack?: string
  }
  context: ErrorContext
  strategy: ErrorRecoveryStrategy
  environment: {
    nodeVersion: string
    platform: string
    memory: NodeJS.MemoryUsage
  }
}

export interface ErrorReportingConfig {
  enabled: boolean
  endpoint?: string
  apiKey?: string
  batchSize?: number
  flushInterval?: number
  includeStackTrace?: boolean
  includeSensitiveData?: boolean
}

export class ErrorReporter {
  private reports: ErrorReport[] = []
  private config: ErrorReportingConfig
  private flushTimer?: NodeJS.Timeout
  private reportCount = 0

  constructor(config: Partial<ErrorReportingConfig> = {}) {
    this.config = {
      enabled: process.env.ERROR_REPORTING_ENABLED === 'true',
      endpoint: process.env.ERROR_REPORTING_ENDPOINT,
      apiKey: process.env.ERROR_REPORTING_API_KEY,
      batchSize: 10,
      flushInterval: 60000, // 1 minute
      includeStackTrace: process.env.NODE_ENV !== 'production',
      includeSensitiveData: false,
      ...config
    }

    if (this.config.enabled && this.config.flushInterval) {
      this.startAutoFlush()
    }
  }

  async report(
    error: Error,
    context: ErrorContext,
    strategy: ErrorRecoveryStrategy
  ): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    const report: ErrorReport = {
      id: this.generateReportId(),
      timestamp: new Date(),
      error: {
        name: error.name,
        message: this.sanitizeMessage(error.message),
        stack: this.config.includeStackTrace ? error.stack : undefined
      },
      context: this.sanitizeContext(context),
      strategy,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
      }
    }

    this.reports.push(report)

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      this.logToConsole(report)
    }

    // Flush if batch size reached
    if (this.reports.length >= this.config.batchSize!) {
      await this.flush()
    }
  }

  private generateReportId(): string {
    return `err_${Date.now()}_${this.reportCount++}_${Math.random().toString(36).substr(2, 9)}`
  }

  private sanitizeMessage(message: string): string {
    if (this.config.includeSensitiveData) {
      return message
    }

    // Remove potential sensitive data
    return message
      .replace(/api[_-]?key[_-]?=?['\"]?[\w-]+/gi, 'API_KEY_REDACTED')
      .replace(/token[_-]?=?['\"]?[\w-]+/gi, 'TOKEN_REDACTED')
      .replace(/password[_-]?=?['\"]?[\w-]+/gi, 'PASSWORD_REDACTED')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, 'EMAIL_REDACTED')
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CARD_NUMBER_REDACTED')
  }

  private sanitizeContext(context: ErrorContext): ErrorContext {
    if (this.config.includeSensitiveData) {
      return context
    }

    const sanitized = { ...context }
    
    // Redact userId if it looks like an email
    if (sanitized.userId && sanitized.userId.includes('@')) {
      sanitized.userId = 'USER_EMAIL_REDACTED'
    }

    // Sanitize metadata
    if (sanitized.metadata) {
      sanitized.metadata = Object.entries(sanitized.metadata).reduce((acc, [key, value]) => {
        if (key.toLowerCase().includes('key') || 
            key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('password')) {
          acc[key] = 'REDACTED'
        } else {
          acc[key] = value
        }
        return acc
      }, {} as Record<string, any>)
    }

    return sanitized
  }

  private logToConsole(report: ErrorReport): void {
    const severityColors = {
      low: '\x1b[36m',      // Cyan
      medium: '\x1b[33m',   // Yellow
      high: '\x1b[31m',     // Red
      critical: '\x1b[35m'  // Magenta
    }

    const color = severityColors[report.strategy.severity]
    const reset = '\x1b[0m'

    console.error(`${color}[ERROR REPORT]${reset}`, {
      id: report.id,
      severity: report.strategy.severity,
      error: report.error.message,
      context: report.context.operation,
      canRecover: report.strategy.canRecover,
      userMessage: report.strategy.userMessage
    })

    if (report.error.stack) {
      console.error('Stack trace:', report.error.stack)
    }
  }

  async flush(): Promise<void> {
    if (this.reports.length === 0) {
      return
    }

    const reportsToSend = [...this.reports]
    this.reports = []

    if (!this.config.endpoint) {
      // If no endpoint configured, just log summary
      console.log(`[Error Reporter] Would send ${reportsToSend.length} error reports`)
      return
    }

    try {
      // Send reports to external service
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        },
        body: JSON.stringify({
          reports: reportsToSend,
          service: 'llm-doc-optimizer',
          environment: process.env.NODE_ENV || 'development'
        })
      })

      if (!response.ok) {
        console.error(`Failed to send error reports: ${response.status} ${response.statusText}`)
        // Re-add reports to queue for retry
        this.reports.unshift(...reportsToSend)
      }
    } catch (error) {
      console.error('Failed to send error reports:', error)
      // Re-add reports to queue for retry
      this.reports.unshift(...reportsToSend)
    }
  }

  private startAutoFlush(): void {
    const flushInterval = this.config.flushInterval
    if (flushInterval) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(error => {
          console.error('Auto-flush failed:', error)
        })
      }, flushInterval)
    }
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = undefined
    }
  }

  getStats(): {
    totalReported: number
    pendingReports: number
    isEnabled: boolean
  } {
    return {
      totalReported: this.reportCount,
      pendingReports: this.reports.length,
      isEnabled: this.config.enabled
    }
  }

  // Get aggregated error metrics
  getMetrics(): {
    errorRate: number
    errorsBySeverity: Record<string, number>
    topErrors: Array<{ message: string; count: number }>
  } {
    const severityCounts: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    }

    const errorMessages: Map<string, number> = new Map()

    for (const report of this.reports) {
      const severity = report.strategy.severity
      if (severity && Object.prototype.hasOwnProperty.call(severityCounts, severity)) {
        severityCounts[severity] = (severityCounts[severity] || 0) + 1
      }
      
      const message = report.error.message
      errorMessages.set(message, (errorMessages.get(message) || 0) + 1)
    }

    const topErrors = Array.from(errorMessages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }))

    return {
      errorRate: this.reports.length / Math.max(1, this.reportCount),
      errorsBySeverity: severityCounts,
      topErrors
    }
  }

  // Clear all pending reports
  clear(): void {
    this.reports = []
  }

  // Shutdown reporter gracefully
  async shutdown(): Promise<void> {
    this.stopAutoFlush()
    await this.flush()
  }
}

// Singleton instance
export const errorReporter = new ErrorReporter()

// Graceful shutdown handler
process.on('beforeExit', () => {
  errorReporter.shutdown().catch(console.error)
})