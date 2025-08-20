# User Story: Create Document Service with Mock Logic

## Story
As a developer, I want a document processing service with mock optimization logic so that I can develop and test the API flow without depending on external services.

## Acceptance Criteria
- [ ] Service processes single documents
- [ ] Service handles multiple documents concurrently
- [ ] Mock optimization returns realistic structure
- [ ] Metadata is generated for each document
- [ ] Service handles errors gracefully

## Technical Details
Create src/services/document.service.ts:
```typescript
export class DocumentService {
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string
  ): Promise<OptimizationResult> {
    // Mock processing delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Generate mock optimized content
    const optimizedContent = this.generateMockOptimization(
      document.content,
      optimizationType
    );
    
    // Generate mock metadata
    const metadata = {
      originalLength: document.content.length,
      optimizedLength: optimizedContent.length,
      processingTime: 100,
      tokenCount: Math.floor(document.content.length / 4),
      entities: ['Company A', 'John Doe', 'Product X'],
      topics: ['policy', 'compliance', 'procedures']
    };
    
    return {
      originalFilename: document.name,
      optimizedContent,
      metadata,
      status: 'fulfilled'
    };
  }
  
  async processMultipleDocuments(
    documents: DocumentInput[],
    optimizationType: string
  ): Promise<OptimizationResult[]> {
    const promises = documents.map(doc => 
      this.optimizeDocument(doc, optimizationType)
    );
    
    const results = await Promise.allSettled(promises);
    return this.consolidateResults(results);
  }
  
  private generateMockOptimization(
    content: string,
    type: string
  ): string {
    // Return structured mock data based on optimization type
    if (type === 'clarity') {
      return `# Optimized Document\n\n## Key Points\n- Point 1\n- Point 2\n- Point 3\n\n## Summary\n${content.substring(0, 200)}...`;
    }
    return `# Style-Optimized Document\n\n${content}`;
  }
}
```

## Definition of Done
- [ ] Service class is fully implemented
- [ ] Mock data is realistic and varied
- [ ] Concurrent processing works correctly
- [ ] Error cases return appropriate responses