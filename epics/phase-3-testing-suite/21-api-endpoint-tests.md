# User Story: Create Integration Tests for API Endpoints

## Story
As an API developer, I want integration tests for all endpoints so that the complete request/response flow is validated including middleware and error handling.

## Acceptance Criteria
- [ ] All endpoints are tested with valid requests
- [ ] Error responses are validated
- [ ] Authentication is tested
- [ ] Request validation is verified
- [ ] Response schemas match specifications

## Technical Details
Create test/integration/api/optimize.test.ts:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { buildApp } from '@/app';

describe('POST /optimize', () => {
  let app: FastifyInstance;
  
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  describe('successful optimization', () => {
    it('should optimize a single document', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          'content-type': 'application/json'
        },
        payload: {
          documents: [{
            name: 'test.txt',
            content: 'This is test content for optimization.'
          }],
          optimizationType: 'clarity',
          mode: 'text'
        }
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        originalFilename: 'test.txt',
        status: 'fulfilled',
        optimizedContent: expect.any(String)
      });
    });
    
    it('should handle multiple documents', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          'content-type': 'application/json'
        },
        payload: {
          documents: [
            { name: 'doc1.txt', content: 'Content 1' },
            { name: 'doc2.txt', content: 'Content 2' },
            { name: 'doc3.txt', content: 'Content 3' }
          ],
          optimizationType: 'style'
        }
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(3);
      body.results.forEach((result: any, index: number) => {
        expect(result.originalFilename).toBe(`doc${index + 1}.txt`);
      });
    });
    
    it('should support different output modes', async () => {
      const modes = ['text', 'json', 'all'];
      
      for (const mode of modes) {
        const response = await app.inject({
          method: 'POST',
          url: '/optimize',
          headers: {
            'x-api-key': process.env.TEST_API_KEY,
            'content-type': 'application/json'
          },
          payload: {
            documents: [{ name: 'test.txt', content: 'Test' }],
            optimizationType: 'clarity',
            mode
          }
        });
        
        expect(response.statusCode).toBe(200);
        
        const body = JSON.parse(response.body);
        if (mode === 'json' || mode === 'all') {
          expect(body.results[0].indexes).toBeDefined();
        }
        if (mode === 'text' || mode === 'all') {
          expect(body.results[0].optimizedContent).toBeDefined();
        }
      }
    });
  });
  
  describe('authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          documents: [{ name: 'test.txt', content: 'Test' }],
          optimizationType: 'clarity'
        }
      });
      
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        error: {
          code: 'AUTH_ERROR',
          message: expect.any(String)
        }
      });
    });
    
    it('should reject requests with invalid API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': 'invalid-key',
          'content-type': 'application/json'
        },
        payload: {
          documents: [{ name: 'test.txt', content: 'Test' }],
          optimizationType: 'clarity'
        }
      });
      
      expect(response.statusCode).toBe(401);
    });
    
    it('should accept valid JWT token', async () => {
      const token = generateTestJWT();
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json'
        },
        payload: {
          documents: [{ name: 'test.txt', content: 'Test' }],
          optimizationType: 'clarity'
        }
      });
      
      expect(response.statusCode).toBe(200);
    });
  });
  
  describe('validation', () => {
    it('should reject empty document array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          'content-type': 'application/json'
        },
        payload: {
          documents: [],
          optimizationType: 'clarity'
        }
      });
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('documents')
        }
      });
    });
    
    it('should reject invalid optimization type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          'content-type': 'application/json'
        },
        payload: {
          documents: [{ name: 'test.txt', content: 'Test' }],
          optimizationType: 'invalid'
        }
      });
      
      expect(response.statusCode).toBe(400);
    });
    
    it('should enforce document size limits', async () => {
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          'content-type': 'application/json'
        },
        payload: {
          documents: [{ name: 'large.txt', content: largeContent }],
          optimizationType: 'clarity'
        }
      });
      
      expect(response.statusCode).toBe(400);
    });
  });
});
```

## Definition of Done
- [ ] All endpoints have integration tests
- [ ] Authentication flows are tested
- [ ] Validation rules are verified
- [ ] Error scenarios return correct codes