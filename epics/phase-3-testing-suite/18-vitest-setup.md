# User Story: Set Up Vitest Testing Framework

## Story
As a developer, I want Vitest configured for testing so that I can write and run tests with modern TypeScript support and fast execution.

## Acceptance Criteria
- [ ] Vitest is installed and configured
- [ ] TypeScript tests work without compilation
- [ ] Test coverage reporting is enabled
- [ ] Watch mode works for development
- [ ] Test utilities are configured

## Technical Details
Create vitest.config.ts:
```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'test/',
        '*.config.ts',
        'dist/'
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 1000,
    isolate: true,
    threads: true,
    mockReset: true,
    restoreMocks: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test')
    }
  }
});
```

Create test/setup.ts:
```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

beforeAll(async () => {
  console.log('🧪 Starting test suite');
});

afterAll(async () => {
  console.log('✅ Test suite completed');
});

beforeEach(() => {
  // Reset any global state
  vi.clearAllMocks();
});

// Global test utilities
global.testHelpers = {
  createMockRequest: () => ({
    headers: { 'x-api-key': 'test-key' },
    body: { documents: [] }
  }),
  
  createMockDocument: (overrides = {}) => ({
    name: 'test.txt',
    content: 'Test content',
    type: 'note',
    ...overrides
  })
};
```

## Definition of Done
- [ ] npm test runs Vitest successfully
- [ ] Coverage reports are generated
- [ ] Watch mode works with hot reload
- [ ] Test helpers are available globally