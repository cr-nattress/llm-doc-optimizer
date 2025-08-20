# User Story: Test Error Handling Scenarios

## Story
As a developer, I want comprehensive error handling tests so that the application gracefully handles all failure scenarios and provides helpful error messages.

## Acceptance Criteria
- [ ] Custom error classes are tested
- [ ] Global error handler is verified
- [ ] Error logging is validated
- [ ] Sensitive data is not leaked
- [ ] All error paths return correct status codes

## Technical Details
Create test/unit/middleware/error-handler.test.ts:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  ApplicationError,
  ValidationError,
  AuthenticationError,
  OpenAIError 
} from '@/middleware/error-handler';
import { buildApp } from '@/app';

describe('Error Handling', () => {
  describe('Custom Error Classes', () => {
    it('should create ValidationError with details', () => {
      const error = new ValidationError('Invalid input', {
        field: 'email',
        reason: 'Invalid format'
      });
      
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({
        field: 'email',
        reason: 'Invalid format'
      });
    });
    
    it('should create AuthenticationError with default message', () => {
      const error = new AuthenticationError();
      
      expect(error.message).toBe('Authentication required');
      expect(error.statusCode).toBe(401);
      expect(error.errorCode).toBe('AUTH_ERROR');
    });
    
    it('should create OpenAIError with custom status', () => {
      const error = new OpenAIError('Rate limit exceeded', 429);
      
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.statusCode).toBe(429);
      expect(error.errorCode).toBe('OPENAI_ERROR');
    });
  });
  
  describe('Global Error Handler', () => {
    let app;
    
    beforeEach(async () => {
      app = await buildApp({ logger: false });
    });
    
    it('should handle ValidationError correctly', async () => {
      app.get('/test-validation', async () => {
        throw new ValidationError('Missing required field', {
          field: 'name'
        });
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-validation'
      });
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error: {
          message: 'Missing required field',
          code: 'VALIDATION_ERROR',
          statusCode: 400
        }
      });
    });
    
    it('should handle generic errors as 500', async () => {
      app.get('/test-generic', async () => {
        throw new Error('Something went wrong');
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-generic'
      });
      
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        error: {
          message: 'Something went wrong',
          code: 'INTERNAL_ERROR',
          statusCode: 500
        }
      });
    });
    
    it('should not leak stack traces in production', async () => {
      process.env.NODE_ENV = 'production';
      
      app.get('/test-stack', async () => {
        throw new Error('Internal error');
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-stack'
      });
      
      const body = JSON.parse(response.body);
      expect(body.error.stack).toBeUndefined();
      
      process.env.NODE_ENV = 'test';
    });
    
    it('should include stack traces in development', async () => {
      process.env.NODE_ENV = 'development';
      
      app.get('/test-stack-dev', async () => {
        throw new Error('Debug error');
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-stack-dev'
      });
      
      const body = JSON.parse(response.body);
      expect(body.error.stack).toBeDefined();
      expect(body.error.stack).toContain('Error: Debug error');
      
      process.env.NODE_ENV = 'test';
    });
    
    it('should handle async errors in routes', async () => {
      app.get('/test-async', async () => {
        await new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Async error')), 10);
        });
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-async'
      });
      
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error.message).toBe('Async error');
    });
    
    it('should handle errors in middleware', async () => {
      app.addHook('preHandler', async () => {
        throw new AuthenticationError('Token expired');
      });
      
      app.get('/test-middleware', async () => {
        return { success: true };
      });
      
      const response = await app.inject({
        method: 'GET',
        url: '/test-middleware'
      });
      
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.message).toBe('Token expired');
    });
  });
  
  describe('Error Logging', () => {
    it('should log errors with context', async () => {
      const logSpy = vi.fn();
      const app = await buildApp({
        logger: {
          error: logSpy,
          info: vi.fn(),
          warn: vi.fn()
        }
      });
      
      app.get('/test-logging', async () => {
        throw new Error('Test error for logging');
      });
      
      await app.inject({
        method: 'GET',
        url: '/test-logging',
        headers: { 'x-request-id': 'test-123' }
      });
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          reqId: expect.any(String),
          url: '/test-logging',
          method: 'GET'
        })
      );
    });
    
    it('should not log sensitive data', async () => {
      const logSpy = vi.fn();
      const app = await buildApp({
        logger: { error: logSpy }
      });
      
      app.post('/test-sensitive', async (request) => {
        throw new ValidationError('Invalid password');
      });
      
      await app.inject({
        method: 'POST',
        url: '/test-sensitive',
        headers: {
          'x-api-key': 'secret-key-12345',
          'authorization': 'Bearer secret-token'
        },
        payload: {
          password: 'user-password',
          email: 'test@example.com'
        }
      });
      
      const logCall = logSpy.mock.calls[0][0];
      
      // Check that sensitive data is redacted
      expect(JSON.stringify(logCall)).not.toContain('secret-key-12345');
      expect(JSON.stringify(logCall)).not.toContain('secret-token');
      expect(JSON.stringify(logCall)).not.toContain('user-password');
    });
  });
  
  describe('Not Found Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const app = await buildApp({ logger: false });
      
      const response = await app.inject({
        method: 'GET',
        url: '/unknown-route'
      });
      
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toMatchObject({
        error: {
          message: 'Route not found',
          code: 'NOT_FOUND',
          statusCode: 404
        }
      });
    });
  });
});
```

## Definition of Done
- [ ] All error types are tested
- [ ] Global handler catches all errors
- [ ] Logging includes proper context
- [ ] No sensitive data in error responses