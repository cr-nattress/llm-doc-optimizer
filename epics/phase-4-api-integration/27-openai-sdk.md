# User Story: Install and Configure OpenAI SDK

## Story
As a developer, I want the OpenAI SDK properly configured so that I can make authenticated API calls to GPT-4 for document optimization.

## Acceptance Criteria
- [ ] OpenAI SDK is installed with TypeScript types
- [ ] Client is configured with API key from environment
- [ ] Connection is validated on startup
- [ ] Error handling is implemented
- [ ] Request/response logging is configured

## Technical Details
Install OpenAI SDK:
```bash
npm install openai
npm install --save-dev @types/openai
```

Create src/services/openai.service.ts:
```typescript
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat';

export class OpenAIService {
  private client: OpenAI;
  
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000, // 30 seconds
      maxRetries: 2
    });
  }
  
  async validateConnection(): Promise<boolean> {
    try {
      // Test connection with minimal request
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error('OpenAI connection validation failed:', error);
      return false;
    }
  }
  
  async createCompletion(
    messages: ChatCompletionMessageParam[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } = {}
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const {
      model = 'gpt-4',
      temperature = 0.1,
      maxTokens = 4000,
      stream = false
    } = options;
    
    try {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
        user: 'document-optimizer'
      });
      
      return completion;
    } catch (error) {
      this.handleOpenAIError(error);
      throw error;
    }
  }
  
  private handleOpenAIError(error: unknown): void {
    if (error instanceof OpenAI.APIError) {
      console.error('OpenAI API Error:', {
        status: error.status,
        code: error.code,
        message: error.message,
        type: error.type
      });
    } else {
      console.error('Unexpected OpenAI error:', error);
    }
  }
  
  estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

// Singleton instance
export const openAIService = new OpenAIService();
```

Register as Fastify plugin:
```typescript
// src/plugins/openai.ts
import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { OpenAIService } from '../services/openai.service';

declare module 'fastify' {
  interface FastifyInstance {
    openai: OpenAIService;
  }
}

const openaiPlugin: FastifyPluginAsync = async (fastify) => {
  const openaiService = new OpenAIService();
  
  // Validate connection on startup
  const isConnected = await openaiService.validateConnection();
  if (!isConnected) {
    fastify.log.warn('OpenAI connection validation failed');
  } else {
    fastify.log.info('OpenAI connection validated successfully');
  }
  
  fastify.decorate('openai', openaiService);
};

export default fp(openaiPlugin, {
  name: 'openai'
});
```

## Definition of Done
- [ ] SDK is installed and configured
- [ ] Environment validation works
- [ ] Connection test passes
- [ ] Error handling is comprehensive
- [ ] Plugin integration is complete