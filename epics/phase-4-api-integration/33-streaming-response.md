# User Story: Implement Streaming Response Handling

## Story
As a user, I want streaming responses for long-running optimizations so that I can see progress in real-time and the application feels responsive during processing.

## Acceptance Criteria
- [ ] Streaming responses work for OpenAI API calls
- [ ] Progressive results are sent to client
- [ ] Error handling works with streams
- [ ] Client can handle chunked responses
- [ ] Fallback to non-streaming if unsupported

## Technical Details
Install streaming dependencies:
```bash
npm install @fastify/multipart stream
npm install --save-dev @types/stream
```

Create streaming service:
```typescript
// src/services/streaming.service.ts
import { Readable } from 'stream';
import OpenAI from 'openai';

interface StreamChunk {
  type: 'progress' | 'result' | 'error' | 'complete';
  data: any;
  timestamp: number;
}

export class StreamingService {
  constructor(private openaiService: OpenAIService) {}
  
  async *optimizeDocumentStream(
    document: DocumentInput,
    optimizationType: string,
    model: string = 'gpt-4'
  ): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();
    
    try {
      yield {
        type: 'progress',
        data: {
          stage: 'preparing',
          message: 'Preparing document for optimization...',
          document: document.name
        },
        timestamp: Date.now()
      };
      
      // Prepare prompt
      const template = this.getPromptTemplate(optimizationType);
      const prompt = PromptTemplates.interpolate(template, {
        DOCUMENT_TYPE: document.type || 'document',
        DOCUMENT_NAME: document.name,
        DOCUMENT_CONTENT: document.content
      });
      
      const messages = [
        { role: 'system' as const, content: 'You are a professional document optimizer.' },
        { role: 'user' as const, content: prompt }
      ];
      
      yield {
        type: 'progress',
        data: {
          stage: 'processing',
          message: 'Sending to OpenAI for optimization...',
          model
        },
        timestamp: Date.now()
      };
      
      // Create streaming completion
      const stream = await this.openaiService.createStreamingCompletion(
        messages,
        { model, temperature: 0.1 }
      );
      
      let accumulatedContent = '';
      let tokenCount = 0;
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          accumulatedContent += delta.content;
          tokenCount++;
          
          // Send periodic updates
          if (tokenCount % 10 === 0) {
            yield {
              type: 'progress',
              data: {
                stage: 'streaming',
                message: 'Receiving optimization...',
                partialContent: this.truncateForPreview(accumulatedContent),
                tokensReceived: tokenCount
              },
              timestamp: Date.now()
            };
          }
        }
        
        if (chunk.choices[0]?.finish_reason) {
          break;
        }
      }
      
      // Send final result
      yield {
        type: 'result',
        data: {
          originalFilename: document.name,
          optimizedContent: accumulatedContent,
          metadata: {
            originalLength: document.content.length,
            optimizedLength: accumulatedContent.length,
            processingTime: Date.now() - startTime,
            tokenCount,
            model
          },
          status: 'fulfilled'
        },
        timestamp: Date.now()
      };
      
      yield {
        type: 'complete',
        data: {
          message: 'Optimization completed successfully',
          totalTime: Date.now() - startTime
        },
        timestamp: Date.now()
      };
      
    } catch (error) {
      yield {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          document: document.name,
          stage: 'optimization'
        },
        timestamp: Date.now()
      };
    }
  }
  
  async *optimizeMultipleDocumentsStream(
    documents: DocumentInput[],
    optimizationType: string
  ): AsyncGenerator<StreamChunk> {
    yield {
      type: 'progress',
      data: {
        stage: 'starting',
        message: `Starting optimization of ${documents.length} documents`,
        totalDocuments: documents.length
      },
      timestamp: Date.now()
    };
    
    const results: any[] = [];
    
    // Process documents concurrently but stream results as they complete
    const documentStreams = documents.map((doc, index) => 
      this.processDocumentWithIndex(doc, optimizationType, index)
    );
    
    // Use Promise.allSettled to handle partial failures
    const streamPromises = documentStreams.map(async (streamPromise, index) => {
      try {
        for await (const chunk of await streamPromise) {
          yield {
            ...chunk,
            data: {
              ...chunk.data,
              documentIndex: index,
              documentName: documents[index].name
            }
          };
          
          if (chunk.type === 'result') {
            results.push(chunk.data);
          }
        }
      } catch (error) {
        yield {
          type: 'error',
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
            documentIndex: index,
            documentName: documents[index].name
          },
          timestamp: Date.now()
        };
      }
    });
    
    // Wait for all to complete
    await Promise.allSettled(streamPromises.map(p => this.consumeAsyncGenerator(p)));
    
    yield {
      type: 'complete',
      data: {
        message: 'All documents processed',
        totalResults: results.length,
        successCount: results.filter(r => r.status === 'fulfilled').length,
        failureCount: results.filter(r => r.status === 'rejected').length
      },
      timestamp: Date.now()
    };
  }
  
  private async processDocumentWithIndex(
    document: DocumentInput,
    optimizationType: string,
    index: number
  ) {
    return this.optimizeDocumentStream(document, optimizationType);
  }
  
  private async consumeAsyncGenerator(generator: AsyncGenerator<any>) {
    for await (const _ of generator) {
      // Just consume the generator
    }
  }
  
  private truncateForPreview(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }
  
  private getPromptTemplate(optimizationType: string): string {
    // Same logic as DocumentService
    switch (optimizationType) {
      case 'clarity': return PromptTemplates.CLARITY_OPTIMIZER;
      case 'style': return PromptTemplates.STYLE_OPTIMIZER;
      default: throw new Error(`Unknown optimization type: ${optimizationType}`);
    }
  }
}
```

Update OpenAI service for streaming:
```typescript
// Add to OpenAI service
async createStreamingCompletion(
  messages: ChatCompletionMessageParam[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const {
    model = 'gpt-4',
    temperature = 0.1,
    maxTokens = 4000
  } = options;
  
  return await this.retryManager.executeWithRetry(async () => {
    return await this.client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      user: 'document-optimizer'
    });
  }, `OpenAI streaming ${model}`, {
    maxAttempts: 2, // Fewer retries for streaming
    baseDelay: 1000
  });
}
```

Add streaming endpoint:
```typescript
// src/routes/stream.ts
app.get('/optimize/stream', {
  schema: {
    querystring: {
      type: 'object',
      required: ['documents', 'optimizationType'],
      properties: {
        documents: { type: 'string' }, // JSON string
        optimizationType: { type: 'string', enum: ['clarity', 'style'] },
        model: { type: 'string' }
      }
    }
  }
}, async (request, reply) => {
  const { documents: documentsJson, optimizationType, model } = request.query as any;
  
  let documents: DocumentInput[];
  try {
    documents = JSON.parse(documentsJson);
  } catch {
    reply.code(400).send({ error: 'Invalid documents JSON' });
    return;
  }
  
  // Set up Server-Sent Events
  reply.type('text/event-stream');
  reply.header('Cache-Control', 'no-cache');
  reply.header('Connection', 'keep-alive');
  reply.header('Access-Control-Allow-Origin', '*');
  
  const streamingService = new StreamingService(fastify.openai);
  
  try {
    if (documents.length === 1) {
      for await (const chunk of streamingService.optimizeDocumentStream(
        documents[0],
        optimizationType,
        model
      )) {
        reply.sse(chunk);
      }
    } else {
      for await (const chunk of streamingService.optimizeMultipleDocumentsStream(
        documents,
        optimizationType
      )) {
        reply.sse(chunk);
      }
    }
  } catch (error) {
    reply.sse({
      type: 'error',
      data: {
        error: error instanceof Error ? error.message : 'Stream error'
      },
      timestamp: Date.now()
    });
  }
  
  reply.sse({
    type: 'end',
    data: { message: 'Stream ended' },
    timestamp: Date.now()
  });
});

// Add SSE plugin
import fastifySSE from '@fastify/sse';
app.register(fastifySSE);
```

Add streaming support to main endpoint:
```typescript
// Update main optimize endpoint
app.post('/optimize', {
  schema: {
    body: {
      type: 'object',
      required: ['documents', 'optimizationType'],
      properties: {
        documents: { /* existing schema */ },
        optimizationType: { /* existing schema */ },
        streaming: { type: 'boolean', default: false },
        model: { type: 'string' }
      }
    }
  }
}, async (request, reply) => {
  const { documents, optimizationType, streaming, model } = request.body as any;
  
  if (streaming) {
    // Redirect to streaming endpoint
    reply.type('text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    
    const streamingService = new StreamingService(fastify.openai);
    
    for await (const chunk of streamingService.optimizeMultipleDocumentsStream(
      documents,
      optimizationType
    )) {
      reply.sse(chunk);
    }
    
    return;
  }
  
  // Non-streaming path (existing implementation)
  // ...
});
```

Client-side streaming example:
```typescript
// Example client code for handling streams
function subscribeToOptimization(documents: DocumentInput[], optimizationType: string) {
  const eventSource = new EventSource(
    `/optimize/stream?documents=${encodeURIComponent(JSON.stringify(documents))}&optimizationType=${optimizationType}`
  );
  
  eventSource.onmessage = (event) => {
    const chunk = JSON.parse(event.data);
    
    switch (chunk.type) {
      case 'progress':
        updateProgress(chunk.data);
        break;
      case 'result':
        handleResult(chunk.data);
        break;
      case 'error':
        handleError(chunk.data);
        break;
      case 'complete':
        handleComplete(chunk.data);
        eventSource.close();
        break;
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('Streaming error:', error);
    eventSource.close();
  };
  
  return eventSource;
}
```

## Definition of Done
- [ ] Streaming responses work for single documents
- [ ] Multiple document streaming with progress
- [ ] Error handling preserves stream integrity
- [ ] Client receives real-time updates
- [ ] Fallback to regular HTTP works