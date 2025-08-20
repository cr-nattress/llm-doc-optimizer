# User Story: Create TypeScript Interfaces and Types

## Story
As a developer, I want comprehensive TypeScript interfaces defined so that all data structures are type-safe and self-documenting throughout the application.

## Acceptance Criteria
- [ ] Request/Response interfaces are defined
- [ ] Document processing types are created
- [ ] OpenAI API types are specified
- [ ] Error types are structured
- [ ] All interfaces are exported from index

## Technical Details
Create in src/types/index.ts:
```typescript
export interface OptimizationRequest {
  documents: DocumentInput[];
  mode: 'text' | 'json' | 'all';
  optimizationType: 'clarity' | 'style' | 'consolidate';
}

export interface DocumentInput {
  name: string;
  content: string;
  type?: 'transcript' | 'policy' | 'email' | 'note';
  metadata?: Record<string, unknown>;
}

export interface OptimizationResult {
  originalFilename: string;
  optimizedContent: string;
  indexes?: DocumentIndexes;
  metadata: DocumentMetadata;
  status: 'fulfilled' | 'rejected';
  error?: string;
}

export interface DocumentIndexes {
  entities: EntityIndex[];
  topics: TopicIndex[];
  timeline: TimelineEntry[];
}
```

## Definition of Done
- [ ] All core types are defined
- [ ] Types are imported successfully across modules
- [ ] No TypeScript errors in type definitions
- [ ] JSDoc comments explain complex types