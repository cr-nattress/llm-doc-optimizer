# User Story: Create E2E Tests with Supertest

## Story
As a QA engineer, I want end-to-end tests that validate the complete system flow so that we can ensure the entire application works correctly in a production-like environment.

## Acceptance Criteria
- [ ] Tests run against deployed preview URLs
- [ ] Complete user workflows are tested
- [ ] Real network requests are made
- [ ] Environment variables are properly loaded
- [ ] Tests can run in CI/CD pipeline

## Technical Details
Create test/e2e/optimize.e2e.test.ts:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import FormData from 'form-data';

describe('E2E: Document Optimization Service', () => {
  let request: supertest.SuperTest<supertest.Test>;
  let baseUrl: string;
  let apiKey: string;
  
  beforeAll(() => {
    // Use deploy preview URL if available, otherwise local
    baseUrl = process.env.DEPLOY_URL || 'http://localhost:8888/.netlify/functions';
    apiKey = process.env.E2E_API_KEY || 'test-api-key';
    
    request = supertest(baseUrl);
  });
  
  describe('Complete optimization workflow', () => {
    it('should optimize a single document end-to-end', async () => {
      const form = new FormData();
      form.append('documents', Buffer.from('This is a test document with important information about our company policies and procedures.'), {
        filename: 'company-policy.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(200);
      
      expect(response.body).toHaveProperty('results');
      expect(response.body.results).toHaveLength(1);
      
      const result = response.body.results[0];
      expect(result).toMatchObject({
        originalFilename: 'company-policy.txt',
        status: 'fulfilled',
        optimizedContent: expect.any(String),
        metadata: expect.objectContaining({
          tokenCount: expect.any(Number),
          processingTime: expect.any(Number)
        })
      });
      
      // Verify the content was actually optimized
      expect(result.optimizedContent).toContain('bullet');
      expect(result.optimizedContent.length).toBeGreaterThan(0);
    });
    
    it('should handle multiple documents with consolidation', async () => {
      const form = new FormData();
      
      // Add multiple related documents
      const documents = [
        { name: 'policy1.txt', content: 'Vacation policy: Employees get 15 days PTO.' },
        { name: 'policy2.txt', content: 'Remote work policy: Employees can work from home 2 days per week.' },
        { name: 'policy3.txt', content: 'Equipment policy: Company provides laptop and monitor.' }
      ];
      
      documents.forEach(doc => {
        form.append('documents', Buffer.from(doc.content), {
          filename: doc.name,
          contentType: 'text/plain'
        });
      });
      form.append('optimizationType', 'consolidate');
      
      const response = await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(200);
      
      expect(response.body.results).toHaveLength(1);
      
      const consolidated = response.body.results[0];
      expect(consolidated.optimizedContent).toContain('Table of Contents');
      expect(consolidated.optimizedContent).toContain('policy1.txt');
      expect(consolidated.optimizedContent).toContain('policy2.txt');
      expect(consolidated.optimizedContent).toContain('policy3.txt');
    });
    
    it('should support different output modes', async () => {
      const testModes = ['text', 'json', 'all'];
      
      for (const mode of testModes) {
        const form = new FormData();
        form.append('documents', Buffer.from('Test content for mode testing'), {
          filename: 'test.txt',
          contentType: 'text/plain'
        });
        form.append('optimizationType', 'clarity');
        form.append('mode', mode);
        
        const response = await request
          .post('/optimize')
          .set('X-API-Key', apiKey)
          .set(form.getHeaders())
          .send(form.getBuffer())
          .expect(200);
        
        const result = response.body.results[0];
        
        if (mode === 'text') {
          expect(result.optimizedContent).toBeDefined();
          expect(result.indexes).toBeUndefined();
        } else if (mode === 'json') {
          expect(result.indexes).toBeDefined();
          expect(result.indexes).toHaveProperty('entities');
          expect(result.indexes).toHaveProperty('topics');
        } else if (mode === 'all') {
          expect(result.optimizedContent).toBeDefined();
          expect(result.indexes).toBeDefined();
        }
      }
    });
  });
  
  describe('Error handling in production', () => {
    it('should handle authentication errors properly', async () => {
      const form = new FormData();
      form.append('documents', Buffer.from('Test'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await request
        .post('/optimize')
        .set('X-API-Key', 'invalid-key')
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(401);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatchObject({
        code: 'AUTH_ERROR',
        statusCode: 401
      });
      
      // Ensure no sensitive information is leaked
      expect(JSON.stringify(response.body)).not.toContain('stack');
      expect(JSON.stringify(response.body)).not.toContain(apiKey);
    });
    
    it('should handle validation errors gracefully', async () => {
      const form = new FormData();
      // Missing documents
      form.append('optimizationType', 'clarity');
      
      const response = await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(400);
      
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('document');
    });
    
    it('should handle large file gracefully', async () => {
      const form = new FormData();
      // Create 11MB file (exceeds limit)
      const largeContent = Buffer.alloc(11 * 1024 * 1024, 'x');
      
      form.append('documents', largeContent, {
        filename: 'large.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(400);
      
      expect(response.body.error.message).toContain('size');
    });
  });
  
  describe('Performance and reliability', () => {
    it('should handle concurrent requests', async () => {
      const requests = [];
      
      for (let i = 0; i < 5; i++) {
        const form = new FormData();
        form.append('documents', Buffer.from(`Concurrent test ${i}`), {
          filename: `test${i}.txt`,
          contentType: 'text/plain'
        });
        form.append('optimizationType', 'clarity');
        
        const promise = request
          .post('/optimize')
          .set('X-API-Key', apiKey)
          .set(form.getHeaders())
          .send(form.getBuffer());
        
        requests.push(promise);
      }
      
      const responses = await Promise.all(requests);
      
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.results[0].originalFilename).toBe(`test${index}.txt`);
      });
    });
    
    it('should complete within timeout limits', async () => {
      const form = new FormData();
      form.append('documents', Buffer.from('Performance test content'), {
        filename: 'perf-test.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const startTime = Date.now();
      
      await request
        .post('/optimize')
        .set('X-API-Key', apiKey)
        .set(form.getHeaders())
        .send(form.getBuffer())
        .expect(200);
      
      const duration = Date.now() - startTime;
      
      // Should complete within Netlify's 10-second limit
      expect(duration).toBeLessThan(10000);
    });
  });
  
  describe('Health check', () => {
    it('should respond to health check endpoint', async () => {
      const response = await request
        .get('/health')
        .expect(200);
      
      expect(response.body).toEqual({ status: 'ok' });
    });
  });
});
```

## Definition of Done
- [ ] E2E tests cover all user workflows
- [ ] Tests work against deploy previews
- [ ] Performance is validated
- [ ] Security is verified in production