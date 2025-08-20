import { beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { config } from 'dotenv'
import type { DocumentInput } from '../src/types/index.js'

config({ path: '.env.test' })

beforeAll(async () => {
  console.log('🧪 Starting test suite')
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'silent'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.JWT_SECRET = 'test-jwt-secret'
  process.env.API_KEY = 'test-api-key'
})

afterAll(async () => {
  console.log('✅ Test suite completed')
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetAllMocks()
})

declare global {
  var testHelpers: {
    createMockRequest: (overrides?: any) => any
    createMockDocument: (overrides?: Partial<DocumentInput>) => DocumentInput
    createMockReply: () => any
    wait: (ms: number) => Promise<void>
  }
}

global.testHelpers = {
  createMockRequest: (overrides = {}) => ({
    headers: { 'x-api-key': 'test-key' },
    body: { documents: [] },
    ip: '127.0.0.1',
    parts: vi.fn(),
    jwtVerify: vi.fn(),
    server: { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
    ...overrides
  }),

  createMockDocument: (overrides = {}): DocumentInput => ({
    name: 'test.txt',
    content: 'This is test content for document processing.',
    type: 'note',
    metadata: { test: true },
    ...overrides
  }),

  createMockReply: () => ({
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    headers: vi.fn().mockReturnThis()
  }),

  wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
}