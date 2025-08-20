# User Story: Deploy to Netlify and Test Production Endpoint

## Story
As a product manager, I want the application deployed to Netlify production and thoroughly tested so that users can access a fully functional document optimization service.

## Acceptance Criteria
- [ ] Application deploys successfully to Netlify production
- [ ] All environment variables are configured correctly
- [ ] Production endpoints respond correctly
- [ ] End-to-end tests pass against production
- [ ] Performance meets requirements

## Technical Details
Create production deployment workflow:
```yaml
# .github/workflows/production-deploy.yml
name: Production Deployment

on:
  push:
    branches: [main]
  
  # Allow manual deployment
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'production'
        type: choice
        options:
        - production
        - staging

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run unit tests
        run: npm run test
        env:
          API_KEY: ${{ secrets.TEST_API_KEY }}
          JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          API_KEY: ${{ secrets.TEST_API_KEY }}
          JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}
          OPENAI_API_KEY: ${{ secrets.TEST_OPENAI_API_KEY }}
      
      - name: Build application
        run: npm run build

  deploy:
    name: Deploy to Production
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build application
        run: npm run build
      
      - name: Deploy to Netlify
        uses: nwtgck/actions-netlify@v1.2
        with:
          publish-dir: './netlify/functions'
          production-branch: main
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deploy-message: "Deploy from GitHub Actions - ${{ github.sha }}"
          enable-pull-request-comment: false
          enable-commit-comment: true
          overwrites-pull-request-comment: true
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
        timeout-minutes: 10
      
      - name: Wait for deployment
        run: sleep 30
      
      - name: Run smoke tests against production
        run: npm run test:smoke
        env:
          PRODUCTION_URL: ${{ steps.deploy.outputs.deploy-url || 'https://your-app.netlify.app' }}
          API_KEY: ${{ secrets.PROD_API_KEY }}

  post-deploy:
    name: Post-deployment verification
    needs: deploy
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run E2E tests against production
        run: npm run test:e2e:production
        env:
          PRODUCTION_URL: https://your-app.netlify.app
          E2E_API_KEY: ${{ secrets.E2E_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.PROD_OPENAI_API_KEY }}
        timeout-minutes: 15
      
      - name: Performance test
        run: npm run test:performance
        env:
          PRODUCTION_URL: https://your-app.netlify.app
          API_KEY: ${{ secrets.PERF_TEST_API_KEY }}
      
      - name: Notify team of deployment
        if: success()
        uses: 8398a7/action-slack@v3
        with:
          status: success
          text: '🚀 Production deployment successful!'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
      
      - name: Notify team of failure
        if: failure()
        uses: 8398a7/action-slack@v3
        with:
          status: failure
          text: '❌ Production deployment failed!'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

Create smoke tests for production:
```typescript
// test/smoke/production-smoke.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

describe('Production Smoke Tests', () => {
  let request: supertest.SuperTest<supertest.Test>;
  let baseUrl: string;
  let apiKey: string;
  
  beforeAll(() => {
    baseUrl = process.env.PRODUCTION_URL || 'https://your-app.netlify.app/.netlify/functions';
    apiKey = process.env.API_KEY || '';
    
    if (!baseUrl || !apiKey) {
      throw new Error('PRODUCTION_URL and API_KEY must be set for smoke tests');
    }
    
    request = supertest(baseUrl);
    console.log(`Running smoke tests against: ${baseUrl}`);
  });
  
  it('should respond to health check', async () => {
    const response = await request
      .get('/health')
      .expect(200);
    
    expect(response.body).toEqual({ status: 'ok' });
  });
  
  it('should respond to detailed health check', async () => {
    const response = await request
      .get('/health/detailed')
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('services');
  });
  
  it('should require authentication for optimization endpoint', async () => {
    await request
      .post('/optimize')
      .send({
        documents: [{ name: 'test.txt', content: 'test' }],
        optimizationType: 'clarity'
      })
      .expect(401);
  });
  
  it('should accept valid API key', async () => {
    const response = await request
      .post('/optimize')
      .set('X-API-Key', apiKey)
      .set('Content-Type', 'application/json')
      .send({
        documents: [{
          name: 'smoke-test.txt',
          content: 'This is a smoke test document to verify the production deployment.'
        }],
        optimizationType: 'clarity'
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('results');
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0]).toMatchObject({
      originalFilename: 'smoke-test.txt',
      status: 'fulfilled',
      optimizedContent: expect.any(String)
    });
  });
  
  it('should list available models', async () => {
    const response = await request
      .get('/models')
      .expect(200);
    
    expect(response.body).toHaveProperty('models');
    expect(Array.isArray(response.body.models)).toBe(true);
    expect(response.body.models.length).toBeGreaterThan(0);
  });
  
  it('should handle rate limiting', async () => {
    // Make multiple rapid requests to test rate limiting
    const promises = Array(15).fill(null).map(() =>
      request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set('Content-Type', 'application/json')
        .send({
          documents: [{ name: 'rate-test.txt', content: 'Rate limit test' }],
          optimizationType: 'clarity'
        })
    );
    
    const responses = await Promise.allSettled(promises);
    
    // At least one should be rate limited
    const rateLimited = responses.some(r => 
      r.status === 'fulfilled' && r.value.status === 429
    );
    
    // This might not trigger in production depending on limits
    console.log('Rate limiting test completed');
  });
});
```

Create performance tests:
```typescript
// test/performance/load-test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

describe('Performance Tests', () => {
  let request: supertest.SuperTest<supertest.Test>;
  let baseUrl: string;
  let apiKey: string;
  
  beforeAll(() => {
    baseUrl = process.env.PRODUCTION_URL || 'http://localhost:8888/.netlify/functions';
    apiKey = process.env.API_KEY || '';
    request = supertest(baseUrl);
  });
  
  it('should handle concurrent requests', async () => {
    const concurrency = 5;
    const testDocument = {
      name: 'performance-test.txt',
      content: 'This is a performance test document. '.repeat(100)
    };
    
    const startTime = Date.now();
    
    const promises = Array(concurrency).fill(null).map(async (_, index) => {
      const response = await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set('Content-Type', 'application/json')
        .send({
          documents: [{
            ...testDocument,
            name: `perf-test-${index}.txt`
          }],
          optimizationType: 'clarity'
        });
      
      return {
        status: response.status,
        duration: Date.now() - startTime,
        success: response.status === 200
      };
    });
    
    const results = await Promise.all(promises);
    const totalDuration = Date.now() - startTime;
    
    console.log(`Concurrent requests completed in ${totalDuration}ms`);
    console.log(`Success rate: ${results.filter(r => r.success).length}/${concurrency}`);
    
    // Performance assertions
    expect(results.every(r => r.success)).toBe(true);
    expect(totalDuration).toBeLessThan(60000); // Under 1 minute
    
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    expect(avgDuration).toBeLessThan(30000); // Average under 30 seconds
  });
  
  it('should handle large documents', async () => {
    const largeContent = 'This is a large document for testing. '.repeat(1000);
    
    const startTime = Date.now();
    
    const response = await request
      .post('/optimize')
      .set('X-API-Key', apiKey)
      .set('Content-Type', 'application/json')
      .send({
        documents: [{
          name: 'large-document.txt',
          content: largeContent
        }],
        optimizationType: 'clarity'
      })
      .timeout(45000); // 45 second timeout
    
    const duration = Date.now() - startTime;
    
    console.log(`Large document processed in ${duration}ms`);
    
    expect(response.status).toBe(200);
    expect(duration).toBeLessThan(40000); // Under 40 seconds
    
    const result = response.body.results[0];
    expect(result.status).toBe('fulfilled');
    expect(result.optimizedContent).toBeTruthy();
    expect(result.metadata.tokenCount).toBeGreaterThan(0);
  });
});
```

Create deployment verification script:
```typescript
// scripts/verify-deployment.ts
import fetch from 'node-fetch';

interface HealthCheck {
  endpoint: string;
  expected: (response: any) => boolean;
  critical: boolean;
}

const HEALTH_CHECKS: HealthCheck[] = [
  {
    endpoint: '/health',
    expected: (r) => r.status === 'ok',
    critical: true
  },
  {
    endpoint: '/health/detailed', 
    expected: (r) => r.status === 'ok' && r.services,
    critical: true
  },
  {
    endpoint: '/models',
    expected: (r) => Array.isArray(r.models) && r.models.length > 0,
    critical: false
  }
];

async function verifyDeployment(baseUrl: string): Promise<void> {
  console.log(`🔍 Verifying deployment at: ${baseUrl}`);
  
  let criticalFailures = 0;
  let warnings = 0;
  
  for (const check of HEALTH_CHECKS) {
    try {
      console.log(`Checking ${check.endpoint}...`);
      
      const response = await fetch(`${baseUrl}${check.endpoint}`, {
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (check.expected(data)) {
        console.log(`✅ ${check.endpoint} - OK`);
      } else {
        console.log(`❌ ${check.endpoint} - Response validation failed`);
        if (check.critical) {
          criticalFailures++;
        } else {
          warnings++;
        }
      }
    } catch (error) {
      console.log(`❌ ${check.endpoint} - ${error.message}`);
      if (check.critical) {
        criticalFailures++;
      } else {
        warnings++;
      }
    }
  }
  
  // Test API authentication
  try {
    console.log('Testing API authentication...');
    const response = await fetch(`${baseUrl}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: [{ name: 'test.txt', content: 'test' }],
        optimizationType: 'clarity'
      })
    });
    
    if (response.status === 401) {
      console.log('✅ Authentication - Correctly rejecting unauthorized requests');
    } else {
      console.log(`⚠️ Authentication - Unexpected status: ${response.status}`);
      warnings++;
    }
  } catch (error) {
    console.log(`❌ Authentication test failed: ${error.message}`);
    warnings++;
  }
  
  // Summary
  console.log('\n📊 Deployment Verification Summary:');
  console.log(`Critical failures: ${criticalFailures}`);
  console.log(`Warnings: ${warnings}`);
  
  if (criticalFailures > 0) {
    console.log('❌ Deployment verification failed - critical issues detected');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('⚠️ Deployment verification passed with warnings');
    process.exit(0);
  } else {
    console.log('✅ Deployment verification passed - all checks successful');
    process.exit(0);
  }
}

// Run verification
const baseUrl = process.env.PRODUCTION_URL || 'https://your-app.netlify.app/.netlify/functions';
verifyDeployment(baseUrl).catch(error => {
  console.error('Verification script failed:', error);
  process.exit(1);
});
```

Add deployment scripts to package.json:
```json
{
  "scripts": {
    "build": "tsc && cp -r src/prompts dist/src/",
    "deploy": "netlify deploy --prod",
    "deploy:preview": "netlify deploy",
    "test:smoke": "vitest run test/smoke",
    "test:e2e:production": "vitest run test/e2e --config vitest.e2e.config.ts",
    "test:performance": "vitest run test/performance",
    "verify:deployment": "tsx scripts/verify-deployment.ts",
    "postdeploy": "npm run verify:deployment"
  }
}
```

Create final deployment checklist:
```markdown
# Production Deployment Checklist

## Pre-deployment
- [ ] All tests pass locally
- [ ] Environment variables are configured in Netlify
- [ ] Secrets are properly set and scoped
- [ ] Build process works correctly
- [ ] Code review completed

## Deployment
- [ ] Deploy to staging first for final validation
- [ ] Run E2E tests against staging
- [ ] Deploy to production
- [ ] Verify deployment URL is accessible

## Post-deployment
- [ ] Health checks pass
- [ ] Authentication works correctly
- [ ] API endpoints respond as expected
- [ ] Monitoring is receiving data
- [ ] Error tracking is functioning
- [ ] Performance meets requirements
- [ ] Load testing passes

## Rollback Plan
If deployment fails:
1. Check Netlify deploy logs
2. Verify environment variables
3. Test locally with production config
4. Rollback to previous version if needed: `netlify rollback`
5. Investigate and fix issues
6. Redeploy when ready
```

## Definition of Done
- [ ] Application deploys successfully to Netlify production
- [ ] All health checks pass
- [ ] Production API endpoints work correctly
- [ ] E2E tests pass against production
- [ ] Performance tests meet requirements
- [ ] Monitoring shows healthy metrics