# User Story: Implement JWT/API Key Authentication

## Story
As a security engineer, I want API authentication implemented so that only authorized clients can access the document optimization service.

## Acceptance Criteria
- [ ] JWT validation works for bearer tokens
- [ ] API key validation works for X-API-Key header
- [ ] Unauthorized requests return 401
- [ ] Authentication is applied globally
- [ ] Timing-safe comparison prevents timing attacks

## Technical Details
Create src/middleware/auth.ts:
```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  const apiKey = request.headers['x-api-key'];
  
  // Check for JWT Bearer token
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = await verifyJWT(token);
      request.user = decoded;
      return;
    } catch (error) {
      return reply.code(401).send({
        error: 'Invalid or expired token'
      });
    }
  }
  
  // Check for API key
  if (apiKey) {
    const valid = await validateAPIKey(apiKey as string);
    if (valid) {
      request.user = { type: 'api-key' };
      return;
    }
  }
  
  return reply.code(401).send({
    error: 'Authentication required'
  });
}

async function validateAPIKey(providedKey: string): Promise<boolean> {
  const validKey = process.env.API_KEY;
  if (!validKey) return false;
  
  // Timing-safe comparison
  const provided = Buffer.from(providedKey);
  const valid = Buffer.from(validKey);
  
  if (provided.length !== valid.length) return false;
  
  return timingSafeEqual(provided, valid);
}

// Register as preHandler hook
app.addHook('preHandler', authenticateRequest);
```

## Definition of Done
- [ ] Both JWT and API key auth work
- [ ] Timing attacks are mitigated
- [ ] Health endpoint bypasses auth
- [ ] Auth errors have clear messages