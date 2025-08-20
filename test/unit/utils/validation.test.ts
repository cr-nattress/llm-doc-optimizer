import { describe, it, expect, beforeEach } from 'vitest'
import {
  DocumentInputSchema,
  OptimizationRequestSchema,
  validateRequest,
  sanitizeInput,
  validateEnvironmentVariables,
  isValidJSON,
  validateFileSize,
  validateMimeType,
  allowedMimeTypes
} from '../../../src/utils/validation.js'

describe('Validation Schemas', () => {
  describe('DocumentInputSchema', () => {
    it('should validate valid document input', async () => {
      const validInput = {
        name: 'test.txt',
        content: 'This is test content',
        type: 'note',
        metadata: { author: 'John Doe' }
      }

      const result = await validateRequest(DocumentInputSchema, validInput)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(validInput)
      }
    })

    it('should reject document with empty name', async () => {
      const invalidInput = {
        name: '',
        content: 'Valid content'
      }

      const result = await validateRequest(DocumentInputSchema, invalidInput)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.issues).toContainEqual(
          expect.objectContaining({
            path: ['name']
          })
        )
      }
    })

    it('should reject document with empty content', async () => {
      const invalidInput = {
        name: 'test.txt',
        content: ''
      }

      const result = await validateRequest(DocumentInputSchema, invalidInput)

      expect(result.success).toBe(false)
    })

    it('should reject document with content too long', async () => {
      const invalidInput = {
        name: 'test.txt',
        content: 'A'.repeat(1000001) // Exceeds max length
      }

      const result = await validateRequest(DocumentInputSchema, invalidInput)

      expect(result.success).toBe(false)
    })

    it('should reject invalid document type', async () => {
      const invalidInput = {
        name: 'test.txt',
        content: 'Valid content',
        type: 'invalid-type'
      }

      const result = await validateRequest(DocumentInputSchema, invalidInput)

      expect(result.success).toBe(false)
    })

    it('should accept document without optional fields', async () => {
      const validInput = {
        name: 'test.txt',
        content: 'Valid content'
      }

      const result = await validateRequest(DocumentInputSchema, validInput)

      expect(result.success).toBe(true)
    })
  })

  describe('OptimizationRequestSchema', () => {
    it('should validate valid optimization request', async () => {
      const validRequest = {
        documents: [
          { name: 'doc1.txt', content: 'Content 1' },
          { name: 'doc2.txt', content: 'Content 2' }
        ],
        mode: 'text',
        optimizationType: 'clarity',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 1000
      }

      const result = await validateRequest(OptimizationRequestSchema, validRequest)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.documents).toHaveLength(2)
        expect(result.data.mode).toBe('text')
        expect(result.data.optimizationType).toBe('clarity')
      }
    })

    it('should apply default values', async () => {
      const minimalRequest = {
        documents: [{ name: 'test.txt', content: 'Content' }]
      }

      const result = await validateRequest(OptimizationRequestSchema, minimalRequest)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.mode).toBe('text')
        expect(result.data.optimizationType).toBe('clarity')
      }
    })

    it('should reject empty documents array', async () => {
      const invalidRequest = {
        documents: [],
        optimizationType: 'clarity'
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })

    it('should reject too many documents', async () => {
      const documents = Array.from({ length: 101 }, (_, i) => ({
        name: `doc${i}.txt`,
        content: 'Content'
      }))

      const invalidRequest = {
        documents,
        optimizationType: 'clarity'
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })

    it('should reject invalid mode', async () => {
      const invalidRequest = {
        documents: [{ name: 'test.txt', content: 'Content' }],
        mode: 'invalid-mode',
        optimizationType: 'clarity'
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })

    it('should reject invalid optimization type', async () => {
      const invalidRequest = {
        documents: [{ name: 'test.txt', content: 'Content' }],
        optimizationType: 'invalid-type'
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })

    it('should reject invalid temperature', async () => {
      const invalidRequest = {
        documents: [{ name: 'test.txt', content: 'Content' }],
        optimizationType: 'clarity',
        temperature: 3.0 // Exceeds max
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })

    it('should reject invalid maxTokens', async () => {
      const invalidRequest = {
        documents: [{ name: 'test.txt', content: 'Content' }],
        optimizationType: 'clarity',
        maxTokens: 50 // Below minimum
      }

      const result = await validateRequest(OptimizationRequestSchema, invalidRequest)

      expect(result.success).toBe(false)
    })
  })
})

describe('Validation Utilities', () => {
  describe('sanitizeInput', () => {
    it('should remove script tags', () => {
      const input = 'Safe content <script>alert("xss")</script> more content'
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).toBe('Safe content  more content')
      expect(sanitized).not.toContain('<script>')
    })

    it('should remove iframe tags', () => {
      const input = 'Content <iframe src="evil.com"></iframe> more'
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).not.toContain('<iframe>')
    })

    it('should remove javascript: URLs', () => {
      const input = 'Link to javascript:alert("xss") here'
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).not.toContain('javascript:')
    })

    it('should remove event handlers', () => {
      const input = 'Text onclick="alert()" onload="evil()" content'
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).not.toContain('onclick=')
      expect(sanitized).not.toContain('onload=')
    })

    it('should trim whitespace', () => {
      const input = '  content with spaces  '
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).toBe('content with spaces')
    })

    it('should handle empty input', () => {
      const sanitized = sanitizeInput('')

      expect(sanitized).toBe('')
    })

    it('should preserve safe content', () => {
      const input = 'This is <b>bold</b> and <i>italic</i> text.'
      
      const sanitized = sanitizeInput(input)

      expect(sanitized).toContain('<b>bold</b>')
      expect(sanitized).toContain('<i>italic</i>')
    })
  })

  describe('validateEnvironmentVariables', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should pass when all required variables are present', () => {
      process.env.OPENAI_API_KEY = 'test-key'
      process.env.NODE_ENV = 'test'

      expect(() => validateEnvironmentVariables()).not.toThrow()
    })

    it('should throw in production when required variables are missing', () => {
      delete process.env.OPENAI_API_KEY
      process.env.NODE_ENV = 'production'

      expect(() => validateEnvironmentVariables()).toThrow(
        'Missing required environment variables: OPENAI_API_KEY'
      )
    })

    it('should not throw in development when variables are missing', () => {
      delete process.env.OPENAI_API_KEY
      process.env.NODE_ENV = 'development'

      expect(() => validateEnvironmentVariables()).not.toThrow()
    })

    it('should not throw in test when variables are missing', () => {
      delete process.env.OPENAI_API_KEY
      process.env.NODE_ENV = 'test'

      expect(() => validateEnvironmentVariables()).not.toThrow()
    })
  })

  describe('isValidJSON', () => {
    it('should return true for valid JSON', () => {
      expect(isValidJSON('{"key": "value"}')).toBe(true)
      expect(isValidJSON('[]')).toBe(true)
      expect(isValidJSON('"string"')).toBe(true)
      expect(isValidJSON('123')).toBe(true)
      expect(isValidJSON('true')).toBe(true)
      expect(isValidJSON('null')).toBe(true)
    })

    it('should return false for invalid JSON', () => {
      expect(isValidJSON('{"key": value}')).toBe(false)
      expect(isValidJSON('{key: "value"}')).toBe(false)
      expect(isValidJSON('undefined')).toBe(false)
      expect(isValidJSON('')).toBe(false)
      expect(isValidJSON('{')).toBe(false)
    })
  })

  describe('validateFileSize', () => {
    it('should accept valid file sizes', () => {
      expect(validateFileSize(1000, 2000)).toBe(true)
      expect(validateFileSize(2000, 2000)).toBe(true)
      expect(validateFileSize(1, 1000)).toBe(true)
    })

    it('should reject oversized files', () => {
      expect(validateFileSize(3000, 2000)).toBe(false)
    })

    it('should reject zero or negative sizes', () => {
      expect(validateFileSize(0, 1000)).toBe(false)
      expect(validateFileSize(-100, 1000)).toBe(false)
    })
  })

  describe('validateMimeType', () => {
    it('should accept allowed mime types', () => {
      const allowedTypes = ['text/plain', 'application/json', 'image/*']

      expect(validateMimeType('text/plain', allowedTypes)).toBe(true)
      expect(validateMimeType('application/json', allowedTypes)).toBe(true)
      expect(validateMimeType('image/jpeg', allowedTypes)).toBe(true)
      expect(validateMimeType('image/png', allowedTypes)).toBe(true)
    })

    it('should reject disallowed mime types', () => {
      const allowedTypes = ['text/plain', 'application/json']

      expect(validateMimeType('application/pdf', allowedTypes)).toBe(false)
      expect(validateMimeType('image/jpeg', allowedTypes)).toBe(false)
    })

    it('should handle wildcard types', () => {
      const allowedTypes = ['text/*', 'application/json']

      expect(validateMimeType('text/plain', allowedTypes)).toBe(true)
      expect(validateMimeType('text/html', allowedTypes)).toBe(true)
      expect(validateMimeType('text/markdown', allowedTypes)).toBe(true)
      expect(validateMimeType('application/pdf', allowedTypes)).toBe(false)
    })
  })

  describe('allowedMimeTypes', () => {
    it('should include common document types', () => {
      expect(allowedMimeTypes).toContain('text/plain')
      expect(allowedMimeTypes).toContain('text/markdown')
      expect(allowedMimeTypes).toContain('application/json')
      expect(allowedMimeTypes).toContain('application/pdf')
      expect(allowedMimeTypes).toContain('application/msword')
    })

    it('should include Office document types', () => {
      expect(allowedMimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      expect(allowedMimeTypes).toContain('application/rtf')
    })
  })
})