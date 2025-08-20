# User Story: Replace Mock OpenAI Service with Real API

## Story
As a developer, I want to replace the mock OpenAI service with real API integration so that documents are actually processed by GPT-4 instead of returning static responses.

## Acceptance Criteria
- [ ] Mock service is replaced with real OpenAI calls
- [ ] Existing interfaces are maintained
- [ ] All tests pass with real integration
- [ ] Response format matches mock structure
- [ ] Performance is acceptable

## Technical Details
Update src/services/document.service.ts:
```typescript
import { OpenAIService } from './openai.service';
import { PromptTemplates } from '../prompts/optimize.prompt';
import { DocumentInput, OptimizationResult } from '../types';

export class DocumentService {
  constructor(private openaiService: OpenAIService) {}
  
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string
  ): Promise<OptimizationResult> {
    if (!document.content?.trim()) {
      throw new Error('Document content cannot be empty');
    }
    
    const startTime = Date.now();
    
    try {
      // Select appropriate prompt template
      const template = this.getPromptTemplate(optimizationType);
      
      // Interpolate variables
      const prompt = PromptTemplates.interpolate(template, {
        DOCUMENT_TYPE: document.type || 'document',
        DOCUMENT_NAME: document.name,
        DOCUMENT_CONTENT: document.content
      });
      
      // Create messages for OpenAI
      const messages = [
        {
          role: 'system' as const,
          content: 'You are a professional document optimizer.'
        },
        {
          role: 'user' as const,
          content: prompt
        }
      ];
      
      // Call OpenAI API
      const response = await this.openaiService.createCompletion(messages, {
        model: 'gpt-4',
        temperature: 0.1,
        maxTokens: 4000
      });
      
      const optimizedContent = response.choices[0]?.message?.content || '';
      
      if (!optimizedContent) {
        throw new Error('OpenAI returned empty response');
      }
      
      // Extract JSON indexes if present
      const indexes = this.extractIndexes(optimizedContent);
      
      // Generate metadata
      const metadata = {
        originalLength: document.content.length,
        optimizedLength: optimizedContent.length,
        processingTime: Date.now() - startTime,
        tokenCount: response.usage?.total_tokens || 0,
        model: response.model,
        entities: indexes?.entities?.map(e => e.name) || [],
        topics: indexes?.topics?.map(t => t.name) || []
      };
      
      return {
        originalFilename: document.name,
        optimizedContent: this.cleanOptimizedContent(optimizedContent),
        indexes,
        metadata,
        status: 'fulfilled'
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      return {
        originalFilename: document.name,
        optimizedContent: '',
        metadata: {
          originalLength: document.content.length,
          optimizedLength: 0,
          processingTime,
          tokenCount: 0,
          entities: [],
          topics: []
        },
        status: 'rejected',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  async processMultipleDocuments(
    documents: DocumentInput[],
    optimizationType: string
  ): Promise<OptimizationResult[]> {
    // Process documents in parallel with error handling
    const promises = documents.map(doc => 
      this.optimizeDocument(doc, optimizationType)
    );
    
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          originalFilename: documents[index].name,
          optimizedContent: '',
          metadata: {
            originalLength: documents[index].content.length,
            optimizedLength: 0,
            processingTime: 0,
            tokenCount: 0,
            entities: [],
            topics: []
          },
          status: 'rejected' as const,
          error: result.reason?.message || 'Processing failed'
        };
      }
    });
  }
  
  async consolidateDocuments(
    optimizedResults: OptimizationResult[]
  ): Promise<string> {
    const successfulResults = optimizedResults.filter(r => r.status === 'fulfilled');
    
    if (successfulResults.length === 0) {
      throw new Error('No documents to consolidate');
    }
    
    // Prepare documents for consolidation
    const documentsData = successfulResults.map(result => ({
      name: result.originalFilename,
      content: result.optimizedContent,
      type: this.detectDocumentType(result.originalFilename),
      metadata: result.metadata
    }));
    
    const prompt = PromptTemplates.interpolate(
      PromptTemplates.CONSOLIDATOR,
      {
        DOCUMENTS_JSON: JSON.stringify(documentsData, null, 2)
      }
    );
    
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a document consolidation specialist.'
      },
      {
        role: 'user' as const,
        content: prompt
      }
    ];
    
    const response = await this.openaiService.createCompletion(messages, {
      model: 'gpt-4',
      temperature: 0.1,
      maxTokens: 8000
    });
    
    return response.choices[0]?.message?.content || '';
  }
  
  private getPromptTemplate(optimizationType: string): string {
    switch (optimizationType) {
      case 'clarity':
        return PromptTemplates.CLARITY_OPTIMIZER;
      case 'style':
        return PromptTemplates.STYLE_OPTIMIZER;
      case 'consolidate':
        return PromptTemplates.CONSOLIDATOR;
      default:
        throw new Error(`Unknown optimization type: ${optimizationType}`);
    }
  }
  
  private extractIndexes(content: string): any {
    // Look for JSON blocks in the response
    const jsonRegex = /```json\n([\s\S]*?)\n```/g;
    const matches = Array.from(content.matchAll(jsonRegex));
    
    if (matches.length > 0) {
      try {
        return JSON.parse(matches[0][1]);
      } catch {
        // Invalid JSON, return null
        return null;
      }
    }
    
    return null;
  }
  
  private cleanOptimizedContent(content: string): string {
    // Remove JSON blocks from the main content
    return content.replace(/```json\n[\s\S]*?\n```/g, '').trim();
  }
  
  private detectDocumentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const name = filename.toLowerCase();
    
    if (name.includes('policy')) return 'policy';
    if (name.includes('transcript')) return 'transcript';
    if (name.includes('email')) return 'email';
    if (name.includes('note')) return 'note';
    
    return 'document';
  }
}
```

Update route handler to use real service:
```typescript
// In optimize.ts
const documentService = new DocumentService(fastify.openai);

// Replace usage
const results = await documentService.processMultipleDocuments(
  documents,
  optimizationType
);
```

## Definition of Done
- [ ] Mock service is completely replaced
- [ ] Real OpenAI API calls work
- [ ] Error handling covers API failures
- [ ] Response format is consistent
- [ ] Tests pass with real integration