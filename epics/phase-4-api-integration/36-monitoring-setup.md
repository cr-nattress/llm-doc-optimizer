# User Story: Set Up Monitoring and Log Drains

## Story
As a DevOps engineer, I want comprehensive monitoring and log drains configured so that I can observe system behavior, diagnose issues, and maintain service reliability in production.

## Acceptance Criteria
- [ ] Log drains are configured for external aggregation
- [ ] Application metrics are collected and visualized
- [ ] Error tracking is integrated
- [ ] Performance monitoring is active
- [ ] Alerting is configured for critical issues

## Technical Details
Configure structured logging with drain integration:
```typescript
// src/utils/logger.ts
import pino from 'pino';
import { config } from '../config/env-validation';

interface LogContext {
  requestId?: string;
  userId?: string;
  operation?: string;
  duration?: number;
  tokenUsage?: any;
  cost?: number;
}

export class Logger {
  private logger: pino.Logger;
  
  constructor() {
    this.logger = pino({
      level: config.LOG_LEVEL,
      
      // Production configuration
      ...(config.NODE_ENV === 'production' && {
        // Structured JSON for log aggregation
        formatters: {
          level: (label: string) => ({ level: label }),
          log: (object: any) => object,
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        
        // Custom serializers
        serializers: {
          req: this.requestSerializer,
          res: this.responseSerializer,
          err: pino.stdSerializers.err,
          openaiUsage: this.openaiUsageSerializer,
        },
        
        // Redact sensitive information
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'res.headers["set-cookie"]',
            '*.apiKey',
            '*.password',
            '*.secret',
            '*.token'
          ],
          censor: '[REDACTED]'
        }
      }),
      
      // Development configuration
      ...(config.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard'
          }
        }
      }),
      
      // Base fields for all logs
      base: {
        service: 'document-optimizer',
        version: process.env.npm_package_version || '1.0.0',
        environment: config.NODE_ENV,
        region: process.env.AWS_REGION || 'us-east-1',
        deployId: process.env.NETLIFY_DEPLOY_ID
      }
    });
  }
  
  private requestSerializer(req: any) {
    return {
      method: req.method,
      url: req.url,
      path: req.routerPath,
      parameters: req.params,
      query: req.query,
      remoteAddress: req.ip,
      userAgent: req.headers['user-agent'],
      contentLength: req.headers['content-length']
    };
  }
  
  private responseSerializer(res: any) {
    return {
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      contentLength: res.getHeader('content-length')
    };
  }
  
  private openaiUsageSerializer(usage: any) {
    return {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCost: usage.estimatedCost,
      model: usage.model
    };
  }
  
  // Structured logging methods
  info(message: string, context?: LogContext) {
    this.logger.info(context || {}, message);
  }
  
  error(message: string, error?: Error, context?: LogContext) {
    this.logger.error({ err: error, ...context }, message);
  }
  
  warn(message: string, context?: LogContext) {
    this.logger.warn(context || {}, message);
  }
  
  debug(message: string, context?: LogContext) {
    this.logger.debug(context || {}, message);
  }
  
  // Business-specific logging
  logDocumentProcessing(
    operation: string,
    documentName: string,
    duration: number,
    tokens: number,
    cost: number,
    success: boolean
  ) {
    this.info(`Document processing ${success ? 'completed' : 'failed'}`, {
      operation,
      documentName,
      duration,
      tokenUsage: tokens,
      cost,
      success
    });
  }
  
  logAPIUsage(
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    userId?: string
  ) {
    this.info('API request processed', {
      operation: `${method} ${endpoint}`,
      statusCode,
      duration: responseTime,
      userId
    });
  }
  
  logRateLimitHit(
    limitType: string,
    identifier: string,
    limit: number,
    current: number
  ) {
    this.warn('Rate limit exceeded', {
      operation: 'rate_limit',
      limitType,
      identifier,
      limit,
      current
    });
  }
  
  logCircuitBreakerEvent(
    service: string,
    state: string,
    failureCount: number
  ) {
    this.error('Circuit breaker state change', undefined, {
      operation: 'circuit_breaker',
      service,
      state,
      failureCount
    });
  }
}

export const logger = new Logger();
```

Configure metrics collection:
```typescript
// src/utils/metrics.ts
interface Metric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private flushInterval: NodeJS.Timeout;
  
  constructor(private batchSize: number = 100) {
    // Flush metrics periodically
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 30000); // 30 seconds
  }
  
  // Counter metrics
  incrementCounter(name: string, tags?: Record<string, string>) {
    this.addMetric(name, 1, tags);
  }
  
  // Gauge metrics
  recordGauge(name: string, value: number, tags?: Record<string, string>) {
    this.addMetric(name, value, tags);
  }
  
  // Histogram metrics
  recordHistogram(name: string, value: number, tags?: Record<string, string>) {
    this.addMetric(name, value, tags);
  }
  
  // Business metrics
  recordDocumentProcessed(
    optimizationType: string,
    model: string,
    success: boolean,
    duration: number,
    tokenCount: number,
    cost: number
  ) {
    const tags = {
      optimization_type: optimizationType,
      model,
      status: success ? 'success' : 'failure'
    };
    
    this.incrementCounter('documents_processed_total', tags);
    this.recordHistogram('document_processing_duration_ms', duration, tags);
    this.recordHistogram('document_processing_tokens', tokenCount, tags);
    this.recordHistogram('document_processing_cost_usd', cost, tags);
  }
  
  recordAPIRequest(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number
  ) {
    const tags = {
      endpoint,
      method,
      status_code: statusCode.toString(),
      status_class: `${Math.floor(statusCode / 100)}xx`
    };
    
    this.incrementCounter('api_requests_total', tags);
    this.recordHistogram('api_request_duration_ms', duration, tags);
  }
  
  recordRateLimit(limitType: string, identifier: string) {
    this.incrementCounter('rate_limits_hit_total', {
      limit_type: limitType,
      identifier
    });
  }
  
  recordCircuitBreakerEvent(service: string, event: string) {
    this.incrementCounter('circuit_breaker_events_total', {
      service,
      event
    });
  }
  
  private addMetric(name: string, value: number, tags?: Record<string, string>) {
    this.metrics.push({
      name,
      value,
      tags,
      timestamp: Date.now()
    });
    
    if (this.metrics.length >= this.batchSize) {
      this.flush();
    }
  }
  
  private async flush() {
    if (this.metrics.length === 0) return;
    
    const batch = [...this.metrics];
    this.metrics = [];
    
    try {
      await this.sendMetrics(batch);
    } catch (error) {
      console.error('Failed to send metrics:', error);
      // Could implement retry logic here
    }
  }
  
  private async sendMetrics(metrics: Metric[]) {
    // Send to DataDog
    if (config.DATADOG_API_KEY) {
      await this.sendToDatadog(metrics);
    }
    
    // Send to custom webhook
    if (config.METRICS_WEBHOOK_URL) {
      await this.sendToWebhook(metrics);
    }
    
    // Log metrics in structured format for log-based monitoring
    logger.info('Metrics batch', { metrics: metrics.length });
  }
  
  private async sendToDatadog(metrics: Metric[]) {
    const payload = {
      series: metrics.map(metric => ({
        metric: `document_optimizer.${metric.name}`,
        points: [[metric.timestamp! / 1000, metric.value]],
        tags: metric.tags ? Object.entries(metric.tags).map(([k, v]) => `${k}:${v}`) : []
      }))
    };
    
    await fetch('https://api.datadoghq.com/api/v1/series', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': config.DATADOG_API_KEY!
      },
      body: JSON.stringify(payload)
    });
  }
  
  private async sendToWebhook(metrics: Metric[]) {
    await fetch(config.METRICS_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics })
    });
  }
  
  dispose() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush(); // Final flush
  }
}

export const metrics = new MetricsCollector();
```

Configure error tracking with Sentry:
```typescript
// src/utils/error-tracking.ts
import * as Sentry from '@sentry/node';
import { config } from '../config/env-validation';

export function initializeErrorTracking() {
  if (!config.SENTRY_DSN) {
    console.log('Sentry DSN not configured, skipping error tracking setup');
    return;
  }
  
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: process.env.npm_package_version,
    
    // Performance monitoring
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // Error filtering
    beforeSend(event, hint) {
      // Filter out known non-critical errors
      const error = hint.originalException;
      
      if (error instanceof Error) {
        // Don't send authentication errors to Sentry
        if (error.message.includes('Authentication') || 
            error.message.includes('Unauthorized')) {
          return null;
        }
        
        // Don't send rate limit errors
        if (error.message.includes('Rate limit')) {
          return null;
        }
      }
      
      return event;
    },
    
    // Additional context
    initialScope: {
      tags: {
        service: 'document-optimizer',
        version: process.env.npm_package_version
      },
      contexts: {
        runtime: {
          name: 'node',
          version: process.version
        }
      }
    }
  });
  
  console.log('Sentry error tracking initialized');
}

export function captureDocumentProcessingError(
  error: Error,
  document: string,
  optimizationType: string,
  model?: string
) {
  Sentry.withScope((scope) => {
    scope.setTag('operation', 'document_processing');
    scope.setContext('document', {
      name: document,
      optimization_type: optimizationType,
      model
    });
    
    Sentry.captureException(error);
  });
}

export function captureAPIError(
  error: Error,
  endpoint: string,
  method: string,
  userId?: string
) {
  Sentry.withScope((scope) => {
    scope.setTag('operation', 'api_request');
    scope.setContext('api', {
      endpoint,
      method,
      user_id: userId
    });
    
    Sentry.captureException(error);
  });
}
```

Create monitoring dashboard configuration:
```typescript
// scripts/create-dashboard.ts
export const dashboardConfig = {
  title: "Document Optimizer - Production Monitoring",
  description: "Key metrics and alerts for the document optimization service",
  
  widgets: [
    {
      title: "Request Volume",
      type: "timeseries",
      query: "sum(rate(api_requests_total[5m])) by (endpoint)",
      yAxis: { label: "Requests/sec" }
    },
    {
      title: "Response Times",
      type: "timeseries", 
      query: "histogram_quantile(0.95, rate(api_request_duration_ms_bucket[5m]))",
      yAxis: { label: "Duration (ms)" }
    },
    {
      title: "Error Rate",
      type: "timeseries",
      query: "sum(rate(api_requests_total{status_class=\"4xx\"}[5m])) / sum(rate(api_requests_total[5m]))",
      yAxis: { label: "Error %" }
    },
    {
      title: "Document Processing",
      type: "timeseries",
      query: "sum(rate(documents_processed_total[5m])) by (optimization_type, status)",
      yAxis: { label: "Documents/sec" }
    },
    {
      title: "OpenAI Token Usage",
      type: "timeseries",
      query: "sum(rate(document_processing_tokens[5m]))",
      yAxis: { label: "Tokens/sec" }
    },
    {
      title: "Estimated Costs",
      type: "timeseries",
      query: "sum(rate(document_processing_cost_usd[5m])) * 3600",
      yAxis: { label: "USD/hour" }
    },
    {
      title: "Rate Limits",
      type: "timeseries",
      query: "sum(rate(rate_limits_hit_total[5m])) by (limit_type)",
      yAxis: { label: "Limits Hit/sec" }
    },
    {
      title: "Circuit Breaker Status",
      type: "stat",
      query: "sum(circuit_breaker_events_total) by (service, event)"
    }
  ],
  
  alerts: [
    {
      name: "High Error Rate",
      condition: "sum(rate(api_requests_total{status_class=\"5xx\"}[5m])) / sum(rate(api_requests_total[5m])) > 0.05",
      severity: "critical",
      description: "Error rate above 5% for 5 minutes"
    },
    {
      name: "High Response Time",
      condition: "histogram_quantile(0.95, rate(api_request_duration_ms_bucket[5m])) > 10000",
      severity: "warning", 
      description: "95th percentile response time above 10 seconds"
    },
    {
      name: "OpenAI Quota Alert",
      condition: "increase(documents_processed_total{status=\"failure\"}[10m]) > 10",
      severity: "critical",
      description: "Multiple OpenAI failures detected"
    },
    {
      name: "High Cost Alert",
      condition: "sum(rate(document_processing_cost_usd[1h])) > 50",
      severity: "warning",
      description: "Hourly costs above $50"
    }
  ]
};
```

Configure log drain for Netlify:
```bash
# Configure log drain using Netlify CLI
netlify logs:configure --drain-url="https://logs.your-service.com/ingest" --drain-format=json

# Or via environment variable
netlify env:set LOG_DRAIN_URL "https://logs.your-service.com/ingest" --context production
```

Integrate monitoring into the application:
```typescript
// src/app.ts
import { initializeErrorTracking } from './utils/error-tracking';
import { logger } from './utils/logger';
import { metrics } from './utils/metrics';

export async function buildApp(opts: any = {}) {
  // Initialize monitoring
  initializeErrorTracking();
  
  const app = Fastify({
    logger: false, // We use our custom logger
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId'
  });
  
  // Add monitoring hooks
  app.addHook('onRequest', async (request, reply) => {
    request.startTime = Date.now();
    logger.info('Request started', {
      requestId: request.id,
      operation: `${request.method} ${request.url}`
    });
  });
  
  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - (request as any).startTime;
    
    logger.logAPIUsage(
      request.url,
      request.method,
      reply.statusCode,
      duration,
      (request as any).user?.id
    );
    
    metrics.recordAPIRequest(
      request.url,
      request.method,
      reply.statusCode,
      duration
    );
  });
  
  app.addHook('onError', async (request, reply, error) => {
    logger.error('Request error', error, {
      requestId: request.id,
      operation: `${request.method} ${request.url}`
    });
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    metrics.dispose();
    process.exit(0);
  });
  
  return app;
}
```

## Definition of Done
- [ ] Structured logging is configured with drain integration
- [ ] Application metrics are collected and sent to monitoring service
- [ ] Error tracking captures and categorizes errors appropriately
- [ ] Monitoring dashboard shows key business and technical metrics
- [ ] Alerts are configured for critical issues