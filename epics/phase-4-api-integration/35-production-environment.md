# User Story: Configure Production Environment Variables

## Story
As a DevOps engineer, I want production environment variables properly configured in Netlify so that the application runs securely with real credentials and optimal settings.

## Acceptance Criteria
- [ ] All required environment variables are configured
- [ ] Secrets are stored securely in Netlify
- [ ] Environment-specific configurations are set
- [ ] Variables are scoped correctly
- [ ] Configuration validation works

## Technical Details
Configure Netlify environment variables through the UI or CLI:

### Required Production Variables
```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-...  # Your OpenAI API key
OPENAI_ORG_ID=org-...  # Optional: OpenAI organization ID

# Authentication
JWT_SECRET=your-secure-jwt-secret-here  # 256-bit secret
API_KEY=your-secure-api-key-here        # For API key auth

# Service Configuration
NODE_ENV=production
LOG_LEVEL=info
MAX_FILE_SIZE=10485760     # 10MB in bytes
MAX_FILES=10
REQUEST_TIMEOUT=30000      # 30 seconds

# Rate Limiting
REDIS_URL=redis://...      # Optional: Redis for distributed rate limiting
GLOBAL_RATE_LIMIT=1000     # Requests per 15 minutes
USER_RATE_LIMIT=50         # Requests per minute per user
API_BUDGET_LIMIT=500       # OpenAI calls per hour

# Model Configuration
DEFAULT_MODEL=gpt-4
FALLBACK_MODEL=gpt-3.5-turbo
ENABLE_MODEL_FALLBACK=true
COST_OPTIMIZATION=true

# Feature Flags
ENABLE_STREAMING=true
ENABLE_DOCUMENT_CHUNKING=true
ENABLE_BATCH_PROCESSING=true
ENABLE_DETAILED_LOGGING=true

# Monitoring
SENTRY_DSN=https://...     # Optional: Error tracking
DATADOG_API_KEY=...        # Optional: Metrics
LOG_DRAIN_URL=...          # Optional: External log aggregation

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
```

Set environment variables using Netlify CLI:
```bash
#!/bin/bash
# scripts/configure-production-env.sh

# Set OpenAI configuration
netlify env:set OPENAI_API_KEY "sk-your-actual-key" --context production
netlify env:set OPENAI_ORG_ID "org-your-org-id" --context production

# Set authentication secrets
netlify env:set JWT_SECRET "$(openssl rand -base64 32)" --context production
netlify env:set API_KEY "$(openssl rand -hex 32)" --context production

# Set service configuration
netlify env:set NODE_ENV "production" --context production
netlify env:set LOG_LEVEL "info" --context production
netlify env:set MAX_FILE_SIZE "10485760" --context production
netlify env:set MAX_FILES "10" --context production
netlify env:set REQUEST_TIMEOUT "30000" --context production

# Set rate limiting
netlify env:set GLOBAL_RATE_LIMIT "1000" --context production
netlify env:set USER_RATE_LIMIT "50" --context production
netlify env:set API_BUDGET_LIMIT "500" --context production

# Set model configuration
netlify env:set DEFAULT_MODEL "gpt-4" --context production
netlify env:set FALLBACK_MODEL "gpt-3.5-turbo" --context production
netlify env:set ENABLE_MODEL_FALLBACK "true" --context production
netlify env:set COST_OPTIMIZATION "true" --context production

# Set feature flags
netlify env:set ENABLE_STREAMING "true" --context production
netlify env:set ENABLE_DOCUMENT_CHUNKING "true" --context production
netlify env:set ENABLE_BATCH_PROCESSING "true" --context production
netlify env:set ENABLE_DETAILED_LOGGING "true" --context production

# Set circuit breaker
netlify env:set CIRCUIT_BREAKER_THRESHOLD "5" --context production
netlify env:set CIRCUIT_BREAKER_TIMEOUT "60000" --context production

echo "Production environment variables configured!"
```

Create staging environment variables:
```bash
# scripts/configure-staging-env.sh

# Staging uses same structure but different values
netlify env:set OPENAI_API_KEY "sk-staging-key" --context deploy-preview
netlify env:set NODE_ENV "staging" --context deploy-preview
netlify env:set LOG_LEVEL "debug" --context deploy-preview
netlify env:set API_BUDGET_LIMIT "100" --context deploy-preview  # Lower limit for staging
netlify env:set DEFAULT_MODEL "gpt-3.5-turbo" --context deploy-preview  # Cheaper model for staging
```

Create environment validation:
```typescript
// src/config/env-validation.ts
import { z } from 'zod';

const envSchema = z.object({
  // OpenAI Configuration
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
  OPENAI_ORG_ID: z.string().optional(),
  
  // Authentication
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  API_KEY: z.string().min(16, 'API key must be at least 16 characters'),
  
  // Service Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  MAX_FILE_SIZE: z.coerce.number().min(1024).default(10485760),
  MAX_FILES: z.coerce.number().min(1).max(50).default(10),
  REQUEST_TIMEOUT: z.coerce.number().min(1000).default(30000),
  
  // Rate Limiting
  REDIS_URL: z.string().url().optional(),
  GLOBAL_RATE_LIMIT: z.coerce.number().min(1).default(1000),
  USER_RATE_LIMIT: z.coerce.number().min(1).default(50),
  API_BUDGET_LIMIT: z.coerce.number().min(1).default(500),
  
  // Model Configuration
  DEFAULT_MODEL: z.string().default('gpt-4'),
  FALLBACK_MODEL: z.string().default('gpt-3.5-turbo'),
  ENABLE_MODEL_FALLBACK: z.coerce.boolean().default(true),
  COST_OPTIMIZATION: z.coerce.boolean().default(false),
  
  // Feature Flags
  ENABLE_STREAMING: z.coerce.boolean().default(false),
  ENABLE_DOCUMENT_CHUNKING: z.coerce.boolean().default(true),
  ENABLE_BATCH_PROCESSING: z.coerce.boolean().default(true),
  ENABLE_DETAILED_LOGGING: z.coerce.boolean().default(false),
  
  // Circuit Breaker
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().min(1).default(5),
  CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().min(1000).default(60000),
  
  // Optional Monitoring
  SENTRY_DSN: z.string().url().optional(),
  DATADOG_API_KEY: z.string().optional(),
  LOG_DRAIN_URL: z.string().url().optional(),
});

export type Environment = z.infer<typeof envSchema>;

let validatedEnv: Environment;

export function getConfig(): Environment {
  if (!validatedEnv) {
    try {
      validatedEnv = envSchema.parse(process.env);
      console.log('Environment validation passed');
    } catch (error) {
      console.error('Environment validation failed:');
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => {
          console.error(`- ${err.path.join('.')}: ${err.message}`);
        });
      }
      process.exit(1);
    }
  }
  
  return validatedEnv;
}

// Validate on module load
export const config = getConfig();
```

Update application to use validated config:
```typescript
// src/app.ts
import { config } from './config/env-validation';

export async function buildApp(opts: any = {}) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' 
        ? { target: 'pino-pretty' } 
        : undefined
    }
  });
  
  // Use validated config throughout the app
  app.register(import('./plugins/openai'), { 
    apiKey: config.OPENAI_API_KEY,
    orgId: config.OPENAI_ORG_ID
  });
  
  app.register(import('./plugins/rate-limit'), {
    redis: config.REDIS_URL,
    globalLimit: config.GLOBAL_RATE_LIMIT,
    userLimit: config.USER_RATE_LIMIT
  });
  
  // Configure timeouts
  app.server.timeout = config.REQUEST_TIMEOUT;
  
  return app;
}
```

Add environment info endpoint:
```typescript
// Add to routes (for debugging, admin only)
app.get('/admin/config', {
  preHandler: [requireAdminAuth]
}, async (request, reply) => {
  const safeConfig = {
    NODE_ENV: config.NODE_ENV,
    LOG_LEVEL: config.LOG_LEVEL,
    MAX_FILE_SIZE: config.MAX_FILE_SIZE,
    MAX_FILES: config.MAX_FILES,
    DEFAULT_MODEL: config.DEFAULT_MODEL,
    FALLBACK_MODEL: config.FALLBACK_MODEL,
    ENABLE_STREAMING: config.ENABLE_STREAMING,
    ENABLE_MODEL_FALLBACK: config.ENABLE_MODEL_FALLBACK,
    COST_OPTIMIZATION: config.COST_OPTIMIZATION,
    // Don't expose sensitive values
    HAS_OPENAI_KEY: !!config.OPENAI_API_KEY,
    HAS_JWT_SECRET: !!config.JWT_SECRET,
    HAS_API_KEY: !!config.API_KEY,
    HAS_REDIS: !!config.REDIS_URL,
    HAS_SENTRY: !!config.SENTRY_DSN
  };
  
  return { config: safeConfig };
});
```

Create environment-specific netlify.toml:
```toml
[build]
  command = "npm run build"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

[functions]
  node_bundler = "esbuild"
  timeout = 30

[functions.optimize]
  timeout = 30

# Production context
[context.production]
  [context.production.environment]
    NODE_ENV = "production"
    LOG_LEVEL = "info"

# Deploy preview context (staging)
[context.deploy-preview]
  [context.deploy-preview.environment]
    NODE_ENV = "staging" 
    LOG_LEVEL = "debug"

# Branch deploys
[context.branch-deploy]
  [context.branch-deploy.environment]
    NODE_ENV = "development"
    LOG_LEVEL = "debug"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    
# Production security headers
[[context.production.headers]]
  for = "/*"
  [context.production.headers.values]
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"
    Content-Security-Policy = "default-src 'self'"
```

Add environment validation to CI/CD:
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  validate-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Validate environment schema
        run: npm run validate-env
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          API_KEY: ${{ secrets.API_KEY }}

  deploy:
    needs: validate-env
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Netlify
        run: echo "Deploy step would go here"
```

## Definition of Done
- [ ] All required environment variables are configured
- [ ] Environment validation prevents startup with invalid config
- [ ] Production secrets are stored securely
- [ ] Different environments have appropriate configurations
- [ ] Configuration can be safely inspected by admins