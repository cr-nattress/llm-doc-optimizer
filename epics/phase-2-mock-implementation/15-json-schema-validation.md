# User Story: Create JSON Schema Validation

## Story
As an API developer, I want request and response validation using JSON schemas so that data integrity is enforced and the API contract is self-documenting.

## Acceptance Criteria
- [ ] Request headers are validated
- [ ] Response bodies match schemas
- [ ] Validation errors return 400 with details
- [ ] Schemas are reusable across routes
- [ ] Fast-json-stringify optimizes responses

## Technical Details
Define schemas:
```typescript
const optimizationRequestSchema = {
  type: 'object',
  required: ['documents', 'optimizationType'],
  properties: {
    documents: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['name', 'content'],
        properties: {
          name: { type: 'string' },
          content: { type: 'string', minLength: 1 },
          type: { 
            type: 'string',
            enum: ['transcript', 'policy', 'email', 'note']
          }
        }
      }
    },
    optimizationType: {
      type: 'string',
      enum: ['clarity', 'style', 'consolidate']
    },
    mode: {
      type: 'string',
      enum: ['text', 'json', 'all'],
      default: 'all'
    }
  }
};

const responseSchema = {
  200: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['originalFilename', 'status'],
          properties: {
            originalFilename: { type: 'string' },
            optimizedContent: { type: 'string' },
            status: { 
              type: 'string',
              enum: ['fulfilled', 'rejected']
            },
            error: { type: 'string' },
            metadata: { type: 'object' }
          }
        }
      },
      processingTime: { type: 'number' }
    }
  },
  400: errorSchema,
  401: errorSchema,
  500: errorSchema
};

// Apply to route
app.post('/optimize', {
  schema: {
    headers: {
      type: 'object',
      required: ['x-api-key'],
      properties: {
        'x-api-key': { type: 'string' }
      }
    },
    response: responseSchema
  }
}, handler);
```

## Definition of Done
- [ ] All routes have schema validation
- [ ] Invalid requests are rejected with details
- [ ] Response serialization is optimized
- [ ] Schemas are documented