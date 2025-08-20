# User Story: Write Unit Tests for Document Service

## Story
As a QA engineer, I want comprehensive unit tests for the document service so that document processing logic is validated and regressions are prevented.

## Acceptance Criteria
- [ ] All public methods are tested
- [ ] Edge cases are covered
- [ ] Error scenarios are tested
- [ ] Mock dependencies are isolated
- [ ] Tests are descriptive and maintainable

## Technical Details
Create test/unit/services/document.service.test.ts:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentService } from '@/services/document.service';
import { MockOpenAIService } from '@/services/openai.mock.service';

describe('DocumentService', () => {
  let documentService: DocumentService;
  let mockOpenAI: MockOpenAIService;
  
  beforeEach(() => {
    mockOpenAI = new MockOpenAIService();
    documentService = new DocumentService(mockOpenAI);
  });
  
  describe('optimizeDocument', () => {
    it('should optimize a single document successfully', async () => {
      const document = {
        name: 'test.txt',
        content: 'This is test content that needs optimization.',
        type: 'note' as const
      };
      
      const result = await documentService.optimizeDocument(
        document,
        'clarity'
      );
      
      expect(result).toMatchObject({
        originalFilename: 'test.txt',
        status: 'fulfilled',
        optimizedContent: expect.any(String),
        metadata: expect.objectContaining({
          tokenCount: expect.any(Number),
          processingTime: expect.any(Number)
        })
      });
    });
    
    it('should handle empty content gracefully', async () => {
      const document = {
        name: 'empty.txt',
        content: '',
        type: 'note' as const
      };
      
      await expect(
        documentService.optimizeDocument(document, 'clarity')
      ).rejects.toThrow('Content cannot be empty');
    });
    
    it('should respect optimization type', async () => {
      const document = testHelpers.createMockDocument();
      
      const clarityResult = await documentService.optimizeDocument(
        document,
        'clarity'
      );
      const styleResult = await documentService.optimizeDocument(
        document,
        'style'
      );
      
      expect(clarityResult.optimizedContent).not.toBe(
        styleResult.optimizedContent
      );
    });
  });
  
  describe('processMultipleDocuments', () => {
    it('should process multiple documents concurrently', async () => {
      const documents = [
        testHelpers.createMockDocument({ name: 'doc1.txt' }),
        testHelpers.createMockDocument({ name: 'doc2.txt' }),
        testHelpers.createMockDocument({ name: 'doc3.txt' })
      ];
      
      const startTime = Date.now();
      const results = await documentService.processMultipleDocuments(
        documents,
        'clarity'
      );
      const duration = Date.now() - startTime;
      
      expect(results).toHaveLength(3);
      expect(duration).toBeLessThan(1000); // Should be concurrent
      
      results.forEach((result, index) => {
        expect(result.originalFilename).toBe(`doc${index + 1}.txt`);
      });
    });
    
    it('should handle partial failures gracefully', async () => {
      const documents = [
        testHelpers.createMockDocument({ name: 'good.txt' }),
        testHelpers.createMockDocument({ 
          name: 'bad.txt',
          content: '' // Will cause error
        }),
        testHelpers.createMockDocument({ name: 'good2.txt' })
      ];
      
      const results = await documentService.processMultipleDocuments(
        documents,
        'clarity'
      );
      
      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[1].error).toBeDefined();
      expect(results[2].status).toBe('fulfilled');
    });
  });
  
  describe('consolidateDocuments', () => {
    it('should merge multiple optimized documents', async () => {
      const optimizedDocs = [
        { content: '# Doc 1', type: 'policy' },
        { content: '# Doc 2', type: 'policy' },
        { content: '# Doc 3', type: 'transcript' }
      ];
      
      const consolidated = await documentService.consolidateDocuments(
        optimizedDocs
      );
      
      expect(consolidated).toContain('# Table of Contents');
      expect(consolidated).toContain('## Policies');
      expect(consolidated).toContain('## Transcripts');
      expect(consolidated).toContain('Doc 1');
      expect(consolidated).toContain('Doc 2');
      expect(consolidated).toContain('Doc 3');
    });
  });
});
```

## Definition of Done
- [ ] All service methods have tests
- [ ] Code coverage exceeds 80%
- [ ] Tests run in under 2 seconds
- [ ] Edge cases are documented in tests