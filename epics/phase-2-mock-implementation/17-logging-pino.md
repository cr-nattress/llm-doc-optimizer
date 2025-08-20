# User Story: Implement Logging with Pino

## Story
As a DevOps engineer, I want structured JSON logging implemented so that I can monitor, debug, and analyze application behavior in production.

## Acceptance Criteria
- [ ] Structured JSON logs in production
- [ ] Pretty-printed logs in development
- [ ] Request IDs trace through all logs
- [ ] Sensitive data is redacted
- [ ] Performance metrics are logged

## Technical Details
Configure Pino logging:
```typescript
import pino from 'pino';
import { FastifyServerOptions } from 'fastify';

const loggerConfig: FastifyServerOptions['logger'] = {
  level: process.env.LOG_LEVEL || 'info',
  
  // Pretty print in development
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard'
      }
    }
  }),
  
  // Redact sensitive fields
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.apiKey'
    ],
    censor: '[REDACTED]'
  },
  
  // Custom serializers
  serializers: {
    req(request) {
      return {
        method: request.method,
        url: request.url,
        path: request.routerPath,
        parameters: request.params,
        headers: request.headers,
        remoteAddress: request.ip,
        remotePort: request.socket.remotePort
      };
    },
    
    res(reply) {
      return {
        statusCode: reply.statusCode,
        responseTime: reply.getResponseTime()
      };
    }
  },
  
  // Add custom fields
  base: {
    service: 'document-optimizer',
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version
  }
};

// Usage in routes
app.post('/optimize', async (request, reply) => {
  const start = Date.now();
  
  request.log.info({ 
    documentCount: request.body.documents.length 
  }, 'Starting document optimization');
  
  try {
    const results = await processDocuments(request.body);
    
    request.log.info({
      duration: Date.now() - start,
      successCount: results.filter(r => r.status === 'fulfilled').length,
      failureCount: results.filter(r => r.status === 'rejected').length
    }, 'Document optimization completed');
    
    return results;
  } catch (error) {
    request.log.error({ err: error }, 'Optimization failed');
    throw error;
  }
});
```

## Definition of Done
- [ ] All significant events are logged
- [ ] Logs include contextual information
- [ ] Sensitive data never appears in logs
- [ ] Log levels are used appropriately