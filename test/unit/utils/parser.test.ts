import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import {
  streamToBuffer,
  detectDocumentType,
  validateFileExtension,
  parseJSONSafely,
  extractTextFromBuffer,
  sanitizeFilename,
  calculateFileHash
} from '../../../src/utils/parser.js'

describe('Parser Utilities', () => {
  describe('streamToBuffer', () => {
    it('should convert readable stream to buffer', async () => {
      const testData = 'Hello, World!'
      const stream = Readable.from([testData])

      const buffer = await streamToBuffer(stream)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString()).toBe(testData)
    })

    it('should handle empty stream', async () => {
      const stream = Readable.from([])

      const buffer = await streamToBuffer(stream)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBe(0)
    })

    it('should handle multiple chunks', async () => {
      const chunks = ['Hello, ', 'World', '!']
      const stream = Readable.from(chunks)

      const buffer = await streamToBuffer(stream)

      expect(buffer.toString()).toBe('Hello, World!')
    })

    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const stream = Readable.from([binaryData])

      const buffer = await streamToBuffer(stream)

      expect(buffer).toEqual(binaryData)
    })

    it('should handle string chunks as buffers', async () => {
      const testData = 'Test string'
      const stream = Readable.from([testData])

      const buffer = await streamToBuffer(stream)

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe(testData)
    })
  })

  describe('detectDocumentType', () => {
    it('should detect transcript files', () => {
      expect(detectDocumentType('meeting-transcript.txt')).toBe('transcript')
      expect(detectDocumentType('TRANSCRIPT-2024.pdf')).toBe('transcript')
      expect(detectDocumentType('weekly-meeting.docx')).toBe('transcript')
    })

    it('should detect policy files', () => {
      expect(detectDocumentType('company-policy.pdf')).toBe('policy')
      expect(detectDocumentType('POLICY-HANDBOOK.docx')).toBe('policy')
      expect(detectDocumentType('employee-handbook.txt')).toBe('policy')
    })

    it('should detect email files', () => {
      expect(detectDocumentType('message.eml')).toBe('email')
      expect(detectDocumentType('EMAIL-THREAD.txt')).toBe('email')
      expect(detectDocumentType('correspondence.eml')).toBe('email')
    })

    it('should detect note files', () => {
      expect(detectDocumentType('project-notes.md')).toBe('note')
      expect(detectDocumentType('MEMO-urgent.txt')).toBe('note')
      expect(detectDocumentType('meeting-note.docx')).toBe('note')
    })

    it('should return undefined for unrecognized files', () => {
      expect(detectDocumentType('random-file.txt')).toBeUndefined()
      expect(detectDocumentType('document.pdf')).toBeUndefined()
      expect(detectDocumentType('file.docx')).toBeUndefined()
    })

    it('should handle case insensitivity', () => {
      expect(detectDocumentType('TRANSCRIPT.TXT')).toBe('transcript')
      expect(detectDocumentType('Policy.PDF')).toBe('policy')
      expect(detectDocumentType('Email.EML')).toBe('email')
    })

    it('should handle files without extensions', () => {
      expect(detectDocumentType('transcript')).toBe('transcript')
      expect(detectDocumentType('policy')).toBe('policy')
      expect(detectDocumentType('email')).toBe('email')
      expect(detectDocumentType('note')).toBe('note')
    })
  })

  describe('validateFileExtension', () => {
    it('should accept allowed extensions', () => {
      const validExtensions = ['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf', '.json']
      
      validExtensions.forEach(ext => {
        expect(validateFileExtension(`test${ext}`)).toBe(true)
        expect(validateFileExtension(`test${ext.toUpperCase()}`)).toBe(true)
      })
    })

    it('should reject disallowed extensions', () => {
      const invalidExtensions = ['.exe', '.bat', '.sh', '.js', '.php', '.asp']
      
      invalidExtensions.forEach(ext => {
        expect(validateFileExtension(`test${ext}`)).toBe(false)
      })
    })

    it('should handle files without extensions', () => {
      expect(validateFileExtension('README')).toBe(false)
      expect(validateFileExtension('filename')).toBe(false)
    })

    it('should handle multiple dots in filename', () => {
      expect(validateFileExtension('file.backup.txt')).toBe(true)
      expect(validateFileExtension('archive.tar.gz')).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(validateFileExtension('')).toBe(false)
      expect(validateFileExtension('.')).toBe(false)
      expect(validateFileExtension('.txt')).toBe(true)
    })
  })

  describe('parseJSONSafely', () => {
    it('should parse valid JSON', () => {
      const validJson = '{"key": "value", "number": 123}'
      
      const result = parseJSONSafely(validJson)

      expect(result).toEqual({ key: 'value', number: 123 })
    })

    it('should handle arrays', () => {
      const arrayJson = '[1, 2, 3, "test"]'
      
      const result = parseJSONSafely(arrayJson)

      expect(result).toEqual([1, 2, 3, 'test'])
    })

    it('should return null for invalid JSON', () => {
      const invalidJson = '{"key": value}' // unquoted value
      
      const result = parseJSONSafely(invalidJson)

      expect(result).toBeNull()
    })

    it('should return null for empty string', () => {
      const result = parseJSONSafely('')

      expect(result).toBeNull()
    })

    it('should handle primitive values', () => {
      expect(parseJSONSafely('123')).toBe(123)
      expect(parseJSONSafely('"string"')).toBe('string')
      expect(parseJSONSafely('true')).toBe(true)
      expect(parseJSONSafely('null')).toBe(null)
    })

    it('should preserve types in parsed result', () => {
      interface TestType {
        name: string
        age: number
        active: boolean
      }

      const jsonString = '{"name": "John", "age": 30, "active": true}'
      
      const result = parseJSONSafely<TestType>(jsonString)

      expect(result).toEqual({ name: 'John', age: 30, active: true })
      expect(typeof result?.name).toBe('string')
      expect(typeof result?.age).toBe('number')
      expect(typeof result?.active).toBe('boolean')
    })
  })

  describe('extractTextFromBuffer', () => {
    it('should extract text from UTF-8 buffer', () => {
      const text = 'Hello, World! 🌍'
      const buffer = Buffer.from(text, 'utf-8')

      const result = extractTextFromBuffer(buffer)

      expect(result).toBe(text)
    })

    it('should handle JSON mime type', () => {
      const jsonData = { message: 'Hello', number: 42 }
      const buffer = Buffer.from(JSON.stringify(jsonData))

      const result = extractTextFromBuffer(buffer, 'application/json')

      expect(result).toBe(JSON.stringify(jsonData, null, 2))
    })

    it('should handle JSON string in JSON mime type', () => {
      const jsonString = '"Just a string"'
      const buffer = Buffer.from(jsonString)

      const result = extractTextFromBuffer(buffer, 'application/json')

      expect(result).toBe('Just a string')
    })

    it('should fallback to UTF-8 for invalid JSON', () => {
      const invalidJson = '{"invalid": json}'
      const buffer = Buffer.from(invalidJson)

      const result = extractTextFromBuffer(buffer, 'application/json')

      expect(result).toBe(invalidJson)
    })

    it('should handle text mime types', () => {
      const text = 'Plain text content'
      const buffer = Buffer.from(text)

      const result = extractTextFromBuffer(buffer, 'text/plain')

      expect(result).toBe(text)
    })

    it('should handle binary data gracefully', () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03])

      const result = extractTextFromBuffer(binaryData)

      expect(typeof result).toBe('string')
    })
  })

  describe('sanitizeFilename', () => {
    it('should replace invalid characters with underscores', () => {
      const unsafeFilename = 'file<>:"/\\|?*name.txt'
      
      const sanitized = sanitizeFilename(unsafeFilename)

      expect(sanitized).toBe('file_name.txt')
      expect(sanitized).not.toMatch(/[<>:"/\\|?*]/)
    })

    it('should preserve valid characters', () => {
      const validFilename = 'valid-file_name.123.txt'
      
      const sanitized = sanitizeFilename(validFilename)

      expect(sanitized).toBe(validFilename)
    })

    it('should handle consecutive invalid characters', () => {
      const filename = 'file***name'
      
      const sanitized = sanitizeFilename(filename)

      expect(sanitized).toBe('file_name')
    })

    it('should truncate long filenames', () => {
      const longFilename = 'a'.repeat(300) + '.txt'
      
      const sanitized = sanitizeFilename(longFilename)

      expect(sanitized.length).toBeLessThanOrEqual(255)
    })

    it('should handle empty filename', () => {
      const sanitized = sanitizeFilename('')

      expect(sanitized).toBe('')
    })

    it('should handle unicode characters', () => {
      const unicodeFilename = 'файл名前.txt'
      
      const sanitized = sanitizeFilename(unicodeFilename)

      // Unicode characters are preserved in our implementation
      expect(sanitized).toBe('файл名前.txt')
    })
  })

  describe('calculateFileHash', () => {
    it('should calculate consistent hash for same content', () => {
      const content = 'Test file content'
      const buffer1 = Buffer.from(content)
      const buffer2 = Buffer.from(content)

      const hash1 = calculateFileHash(buffer1)
      const hash2 = calculateFileHash(buffer2)

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex string
    })

    it('should calculate different hashes for different content', () => {
      const buffer1 = Buffer.from('Content 1')
      const buffer2 = Buffer.from('Content 2')

      const hash1 = calculateFileHash(buffer1)
      const hash2 = calculateFileHash(buffer2)

      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty buffer', () => {
      const buffer = Buffer.from('')

      const hash = calculateFileHash(buffer)

      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should handle binary data', () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF])

      const hash = calculateFileHash(buffer)

      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should produce deterministic results', () => {
      const content = 'Deterministic test content'
      const buffer = Buffer.from(content)

      const hash1 = calculateFileHash(buffer)
      const hash2 = calculateFileHash(buffer)
      const hash3 = calculateFileHash(Buffer.from(content))

      expect(hash1).toBe(hash2)
      expect(hash2).toBe(hash3)
    })
  })
})