# User Story: Add Rate Limiting for API Calls

## Story
As a cost-control engineer, I want rate limiting implemented so that API usage stays within budget limits and prevents abuse while ensuring fair access for all users.

## Acceptance Criteria
- [ ] Per-user rate limits are enforced
- [ ] Global rate limits prevent API abuse
- [ ] Rate limit headers are returned
- [ ] Graceful degradation when limits exceeded
- [ ] Administrative override capability

## Technical Details
Install rate limiting dependencies:
```bash
npm install @fastify/rate-limit ioredis
npm install --save-dev @types/ioredis
```

Create src/middleware/rate-limiter.ts:
```typescript
import Redis from 'ioredis';
import { FastifyRequest } from 'fastify';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (request: FastifyRequest) => string;
}

export class RateLimiterService {
  private redis?: Redis;
  private memoryStore = new Map<string, { count: number; resetTime: number }>();
  
  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL);
      console.log('Rate limiter using Redis store');
    } else {
      console.log('Rate limiter using memory store (single instance only)');
    }
  }
  
  async checkLimit(
    key: string, 
    config: RateLimitConfig
  ): Promise<{
    allowed: boolean;
    count: number;
    remaining: number;
    resetTime: number;
  }> {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    if (this.redis) {
      return this.checkLimitRedis(key, config, now, windowStart);
    } else {
      return this.checkLimitMemory(key, config, now, windowStart);
    }
  }
  
  private async checkLimitRedis(
    key: string, 
    config: RateLimitConfig,
    now: number,
    windowStart: number
  ): Promise<any> {
    const pipeline = this.redis!.pipeline();
    
    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart);
    
    // Count current entries
    pipeline.zcard(key);
    
    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    
    // Set expiration
    pipeline.expire(key, Math.ceil(config.windowMs / 1000));
    
    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) || 0;
    
    const allowed = count < config.max;
    const remaining = Math.max(0, config.max - count - 1);
    const resetTime = now + config.windowMs;
    
    // Remove the request if not allowed
    if (!allowed) {
      await this.redis!.zpop(key);
    }
    
    return { allowed, count: count + (allowed ? 1 : 0), remaining, resetTime };
  }
  
  private checkLimitMemory(
    key: string,
    config: RateLimitConfig,
    now: number,
    windowStart: number
  ): Promise<any> {
    let entry = this.memoryStore.get(key);
    
    // Reset if window expired
    if (!entry || entry.resetTime <= now) {
      entry = { count: 0, resetTime: now + config.windowMs };
      this.memoryStore.set(key, entry);
    }
    
    const allowed = entry.count < config.max;
    
    if (allowed) {
      entry.count++;
    }
    
    const remaining = Math.max(0, config.max - entry.count);
    
    return Promise.resolve({
      allowed,
      count: entry.count,
      remaining,
      resetTime: entry.resetTime
    });
  }
}

// Rate limit configurations
export const RATE_LIMITS = {
  GLOBAL: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // requests per window
    keyGenerator: () => 'global'
  },
  PER_USER: {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // requests per minute per user
    keyGenerator: (request: FastifyRequest) => {
      const user = (request as any).user;
      return user?.id || user?.sub || request.ip || 'anonymous';
    }
  },
  PER_IP: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // requests per window per IP
    keyGenerator: (request: FastifyRequest) => request.ip
  },
  OPENAI_BUDGET: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // API calls per hour
    keyGenerator: () => 'openai-budget'
  }
};
```

Create Fastify plugin:
```typescript
// src/plugins/rate-limit.ts
import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { RateLimiterService, RATE_LIMITS } from '../middleware/rate-limiter';

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter: RateLimiterService;
  }
}

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  const rateLimiter = new RateLimiterService();
  
  fastify.decorate('rateLimiter', rateLimiter);
  
  // Global rate limiting hook
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip rate limiting for health checks
    if (request.url.startsWith('/health')) {
      return;
    }
    
    // Check multiple rate limits
    const checks = await Promise.all([
      rateLimiter.checkLimit(
        RATE_LIMITS.GLOBAL.keyGenerator(),
        RATE_LIMITS.GLOBAL
      ),
      rateLimiter.checkLimit(
        RATE_LIMITS.PER_IP.keyGenerator(request),
        RATE_LIMITS.PER_IP
      ),
      rateLimiter.checkLimit(
        RATE_LIMITS.PER_USER.keyGenerator(request),
        RATE_LIMITS.PER_USER
      )
    ]);
    
    const [globalLimit, ipLimit, userLimit] = checks;
    const mostRestrictive = [globalLimit, ipLimit, userLimit]
      .reduce((min, current) => 
        current.remaining < min.remaining ? current : min
      );
    
    // Set rate limit headers
    reply.headers({
      'X-RateLimit-Limit': RATE_LIMITS.PER_USER.max.toString(),
      'X-RateLimit-Remaining': mostRestrictive.remaining.toString(),
      'X-RateLimit-Reset': new Date(mostRestrictive.resetTime).toISOString()
    });
    
    // Check if any limit exceeded
    if (!globalLimit.allowed || !ipLimit.allowed || !userLimit.allowed) {
      const limitType = !userLimit.allowed ? 'user' :
                       !ipLimit.allowed ? 'IP' : 'global';
      
      reply.code(429).send({
        error: {
          message: `Rate limit exceeded for ${limitType}`,
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429,
          retryAfter: Math.ceil((mostRestrictive.resetTime - Date.now()) / 1000)
        }
      });
      
      return;
    }
  });
};

export default fp(rateLimitPlugin, {
  name: 'rate-limit'
});
```

Add OpenAI-specific rate limiting:
```typescript
// Update document service to check API budget
export class DocumentService {
  constructor(
    private openaiService: OpenAIService,
    private rateLimiter: RateLimiterService
  ) {}
  
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string
  ): Promise<OptimizationResult> {
    // Check OpenAI API budget before making call
    const budgetCheck = await this.rateLimiter.checkLimit(
      'openai-budget',
      RATE_LIMITS.OPENAI_BUDGET
    );
    
    if (!budgetCheck.allowed) {
      throw new Error(
        `OpenAI API budget exceeded. Resets at ${new Date(budgetCheck.resetTime)}`
      );
    }
    
    // Proceed with optimization...
    return this.performOptimization(document, optimizationType);
  }
}
```

Add admin override capability:
```typescript
// Admin endpoints
app.get('/admin/rate-limits/:key', {
  preHandler: [requireAdminAuth]
}, async (request, reply) => {
  const { key } = request.params as { key: string };
  
  // Get current limit status for key
  const status = await fastify.rateLimiter.checkLimit(key, {
    windowMs: 60000,
    max: 1000 // High limit for check
  });
  
  return {
    key,
    ...status
  };
});

app.delete('/admin/rate-limits/:key', {
  preHandler: [requireAdminAuth]
}, async (request, reply) => {
  const { key } = request.params as { key: string };
  
  // Reset rate limit for key (implementation depends on store)
  // For Redis: await redis.del(key)
  // For memory: memoryStore.delete(key)
  
  return { message: `Rate limit reset for ${key}` };
});

async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  
  if (!user || user.role !== 'admin') {
    reply.code(403).send({
      error: 'Admin access required'
    });
    return;
  }
}
```

## Definition of Done
- [ ] Per-user and global rate limits work
- [ ] Rate limit headers are returned
- [ ] 429 responses include retry timing
- [ ] Admin can reset limits when needed
- [ ] OpenAI budget limits prevent overuse