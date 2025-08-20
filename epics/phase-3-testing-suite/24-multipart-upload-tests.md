# User Story: Write Tests for Multipart File Upload

## Story
As a developer, I want tests for multipart file upload functionality so that file handling is reliable and secure across different scenarios.

## Acceptance Criteria
- [ ] Single file upload is tested
- [ ] Multiple file uploads work correctly
- [ ] File size limits are enforced
- [ ] Different file types are handled
- [ ] Memory usage is efficient

## Technical Details
Create test/integration/multipart/upload.test.ts:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '@/app';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { join } from 'path';

describe('Multipart File Upload', () => {
  let app: FastifyInstance;
  
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  describe('single file upload', () => {
    it('should accept single file upload', async () => {
      const form = new FormData();
      form.append('documents', Buffer.from('Test file content'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].originalFilename).toBe('test.txt');
    });
    
    it('should handle large files with streaming', async () => {
      // Create a 5MB test content
      const largeContent = Buffer.alloc(5 * 1024 * 1024, 'x');
      
      const form = new FormData();
      form.append('documents', largeContent, {
        filename: 'large.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(200);
      
      // Verify memory wasn't exhausted
      const memUsage = process.memoryUsage();
      expect(memUsage.heapUsed).toBeLessThan(200 * 1024 * 1024); // < 200MB
    });
  });
  
  describe('multiple file upload', () => {
    it('should accept multiple files', async () => {
      const form = new FormData();
      
      for (let i = 1; i <= 3; i++) {
        form.append('documents', Buffer.from(`Content ${i}`), {
          filename: `file${i}.txt`,
          contentType: 'text/plain'
        });
      }
      form.append('optimizationType', 'style');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(3);
      
      body.results.forEach((result: any, index: number) => {
        expect(result.originalFilename).toBe(`file${index + 1}.txt`);
      });
    });
    
    it('should process files concurrently', async () => {
      const form = new FormData();
      
      // Add 5 files
      for (let i = 1; i <= 5; i++) {
        form.append('documents', Buffer.from(`Content ${i}`.repeat(1000)), {
          filename: `file${i}.txt`,
          contentType: 'text/plain'
        });
      }
      form.append('optimizationType', 'clarity');
      
      const startTime = Date.now();
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      const duration = Date.now() - startTime;
      
      expect(response.statusCode).toBe(200);
      
      // Should be faster than sequential (5 * 100ms min processing time)
      expect(duration).toBeLessThan(500);
    });
  });
  
  describe('file validation', () => {
    it('should reject files exceeding size limit', async () => {
      // Create 11MB content (exceeds 10MB limit)
      const oversizedContent = Buffer.alloc(11 * 1024 * 1024, 'x');
      
      const form = new FormData();
      form.append('documents', oversizedContent, {
        filename: 'huge.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'clarity');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.message).toContain('size');
    });
    
    it('should reject too many files', async () => {
      const form = new FormData();
      
      // Try to upload 11 files (exceeds limit of 10)
      for (let i = 1; i <= 11; i++) {
        form.append('documents', Buffer.from(`File ${i}`), {
          filename: `file${i}.txt`,
          contentType: 'text/plain'
        });
      }
      form.append('optimizationType', 'clarity');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.message).toContain('files');
    });
    
    it('should handle different file types', async () => {
      const form = new FormData();
      
      const fileTypes = [
        { name: 'doc.txt', type: 'text/plain', content: 'Plain text' },
        { name: 'doc.md', type: 'text/markdown', content: '# Markdown' },
        { name: 'doc.json', type: 'application/json', content: '{"key":"value"}' }
      ];
      
      fileTypes.forEach(file => {
        form.append('documents', Buffer.from(file.content), {
          filename: file.name,
          contentType: file.type
        });
      });
      form.append('optimizationType', 'clarity');
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results).toHaveLength(3);
    });
  });
  
  describe('form field handling', () => {
    it('should parse additional form fields', async () => {
      const form = new FormData();
      
      form.append('documents', Buffer.from('Test content'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      });
      form.append('optimizationType', 'style');
      form.append('mode', 'json');
      form.append('metadata', JSON.stringify({ source: 'test' }));
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.results[0].indexes).toBeDefined();
    });
    
    it('should reject missing required fields', async () => {
      const form = new FormData();
      
      form.append('documents', Buffer.from('Test content'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      });
      // Missing optimizationType field
      
      const response = await app.inject({
        method: 'POST',
        url: '/optimize',
        headers: {
          'x-api-key': process.env.TEST_API_KEY,
          ...form.getHeaders()
        },
        payload: form
      });
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.message).toContain('optimizationType');
    });
  });
});
```

## Definition of Done
- [ ] File upload scenarios are tested
- [ ] Size and count limits work
- [ ] Streaming prevents memory issues
- [ ] Form fields are parsed correctly