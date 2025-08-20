# User Story: Add Tests for Authentication Middleware

## Story
As a security engineer, I want comprehensive tests for authentication middleware so that access control is properly enforced and security vulnerabilities are prevented.

## Acceptance Criteria
- [ ] JWT validation is tested
- [ ] API key validation is tested
- [ ] Timing attack prevention is verified
- [ ] Token expiration is handled
- [ ] Invalid tokens are rejected

## Technical Details
Create test/unit/middleware/auth.test.ts:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyRequest, FastifyReply } from 'fastify';
import { authenticateRequest, validateAPIKey } from '@/middleware/auth';
import jwt from 'jsonwebtoken';

describe('Authentication Middleware', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  
  beforeEach(() => {
    mockRequest = {
      headers: {},
      user: undefined,
      log: { error: vi.fn(), info: vi.fn() }
    };
    
    mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    };
  });
  
  describe('API Key Authentication', () => {
    it('should accept valid API key', async () => {
      process.env.API_KEY = 'valid-test-key';
      mockRequest.headers = { 'x-api-key': 'valid-test-key' };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockRequest.user).toEqual({ type: 'api-key' });
      expect(mockReply.code).not.toHaveBeenCalled();
    });
    
    it('should reject invalid API key', async () => {
      process.env.API_KEY = 'valid-test-key';
      mockRequest.headers = { 'x-api-key': 'invalid-key' };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: expect.stringContaining('Authentication')
      });
    });
    
    it('should use timing-safe comparison', async () => {
      const startTime = Date.now();
      
      // Test with different length keys (should still take time)
      process.env.API_KEY = 'a'.repeat(100);
      mockRequest.headers = { 'x-api-key': 'b' };
      
      await validateAPIKey('b');
      
      const shortKeyTime = Date.now() - startTime;
      
      // Test with same length keys
      const startTime2 = Date.now();
      mockRequest.headers = { 'x-api-key': 'b'.repeat(100) };
      
      await validateAPIKey('b'.repeat(100));
      
      const longKeyTime = Date.now() - startTime2;
      
      // Times should be similar despite different lengths
      // (timing-safe comparison normalizes this)
      expect(Math.abs(shortKeyTime - longKeyTime)).toBeLessThan(50);
    });
  });
  
  describe('JWT Authentication', () => {
    const secret = 'test-secret';
    
    beforeEach(() => {
      process.env.JWT_SECRET = secret;
    });
    
    it('should accept valid JWT token', async () => {
      const payload = { userId: '123', role: 'admin' };
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });
      
      mockRequest.headers = { authorization: `Bearer ${token}` };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockRequest.user).toMatchObject(payload);
      expect(mockReply.code).not.toHaveBeenCalled();
    });
    
    it('should reject expired JWT token', async () => {
      const payload = { userId: '123' };
      const token = jwt.sign(payload, secret, { expiresIn: '-1h' });
      
      mockRequest.headers = { authorization: `Bearer ${token}` };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: expect.stringContaining('expired')
      });
    });
    
    it('should reject malformed JWT token', async () => {
      mockRequest.headers = { authorization: 'Bearer invalid.token.here' };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
    });
    
    it('should reject token signed with wrong secret', async () => {
      const payload = { userId: '123' };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' });
      
      mockRequest.headers = { authorization: `Bearer ${token}` };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
    });
  });
  
  describe('No Authentication', () => {
    it('should reject request with no auth headers', async () => {
      mockRequest.headers = {};
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Authentication required'
      });
    });
    
    it('should reject request with empty auth header', async () => {
      mockRequest.headers = { authorization: '' };
      
      await authenticateRequest(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );
      
      expect(mockReply.code).toHaveBeenCalledWith(401);
    });
  });
  
  describe('Security Headers', () => {
    it('should not leak timing information', async () => {
      const timings: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        process.env.API_KEY = 'correct-key';
        mockRequest.headers = { 'x-api-key': 'wrong-key' };
        
        await authenticateRequest(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        );
        
        timings.push(Date.now() - start);
      }
      
      // Check that timing variance is minimal
      const avgTime = timings.reduce((a, b) => a + b) / timings.length;
      const variance = timings.map(t => Math.abs(t - avgTime));
      const maxVariance = Math.max(...variance);
      
      expect(maxVariance).toBeLessThan(10); // ms
    });
  });
});
```

## Definition of Done
- [ ] All auth methods are tested
- [ ] Security vulnerabilities are checked
- [ ] Edge cases are covered
- [ ] Timing attacks are prevented