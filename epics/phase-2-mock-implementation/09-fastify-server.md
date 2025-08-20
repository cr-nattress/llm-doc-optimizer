# User Story: Implement Basic Fastify Server

## Story
As a backend developer, I want a configured Fastify server so that I can handle HTTP requests efficiently in the Netlify Functions environment.

## Acceptance Criteria
- [ ] Fastify instance is created and configured
- [ ] Server works with Netlify Functions handler
- [ ] Plugins are registered correctly
- [ ] Health check endpoint exists
- [ ] Server handles async/await properly

## Technical Details
Create netlify/functions/optimize.ts:
```typescript
import Fastify from 'fastify';
import { Handler } from '@netlify/functions';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
      ? { target: 'pino-pretty' }
      : undefined
  }
});

// Register plugins
app.register(import('@fastify/multipart'));
app.register(import('@fastify/cors'), {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
});

// Health check
app.get('/health', async () => ({ status: 'ok' }));

// Main optimization endpoint
app.post('/optimize', async (request, reply) => {
  // Implementation to follow
  return { message: 'Optimization endpoint' };
});

export const handler: Handler = async (event, context) => {
  const response = await app.inject({
    method: event.httpMethod,
    url: event.path,
    headers: event.headers,
    body: event.body
  });
  
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body
  };
};
```

## Definition of Done
- [ ] Server starts without errors
- [ ] Health endpoint returns 200 OK
- [ ] Netlify dev command works locally
- [ ] Logging outputs to console