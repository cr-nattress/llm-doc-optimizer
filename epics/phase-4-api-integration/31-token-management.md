# User Story: Implement Token Counting and Context Window Management

## Story
As a cost-optimization engineer, I want token counting and context window management so that API costs are controlled and requests don't fail due to exceeding model limits.

## Acceptance Criteria
- [ ] Accurate token counting for prompts and responses
- [ ] Context window limits are respected
- [ ] Document chunking for large inputs
- [ ] Token usage is logged and monitored
- [ ] Cost estimation is provided

## Technical Details
Install token counting library:
```bash
npm install tiktoken
npm install --save-dev @types/tiktoken
```

Create src/utils/token-manager.ts:
```typescript
import { encoding_for_model, TiktokenModel } from 'tiktoken';

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface ModelLimits {
  contextWindow: number;
  maxCompletion: number;
  costPer1kPromptTokens: number;
  costPer1kCompletionTokens: number;
}

export class TokenManager {
  private readonly MODEL_LIMITS: Record<string, ModelLimits> = {
    'gpt-4': {
      contextWindow: 8192,
      maxCompletion: 4096,
      costPer1kPromptTokens: 0.03,
      costPer1kCompletionTokens: 0.06
    },
    'gpt-4-32k': {
      contextWindow: 32768,
      maxCompletion: 4096,
      costPer1kPromptTokens: 0.06,
      costPer1kCompletionTokens: 0.12
    },
    'gpt-4-turbo': {
      contextWindow: 128000,
      maxCompletion: 4096,
      costPer1kPromptTokens: 0.01,
      costPer1kCompletionTokens: 0.03
    }
  };
  
  private encoders = new Map<string, any>();
  
  getTokenCount(text: string, model: string = 'gpt-4'): number {
    try {
      const encoder = this.getEncoder(model);
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch (error) {
      // Fallback to character-based estimation
      console.warn('Token counting failed, using estimation:', error);
      return Math.ceil(text.length / 4);
    }
  }
  
  private getEncoder(model: string) {
    if (!this.encoders.has(model)) {
      try {
        const encoder = encoding_for_model(model as TiktokenModel);
        this.encoders.set(model, encoder);
      } catch {
        // Fallback to GPT-4 encoding
        const encoder = encoding_for_model('gpt-4');
        this.encoders.set(model, encoder);
      }
    }
    return this.encoders.get(model);
  }
  
  validateContextWindow(
    promptText: string,
    maxCompletionTokens: number,
    model: string = 'gpt-4'
  ): {
    valid: boolean;
    promptTokens: number;
    availableTokens: number;
    suggestedModel?: string;
  } {
    const limits = this.MODEL_LIMITS[model];
    if (!limits) {
      throw new Error(`Unknown model: ${model}`);
    }
    
    const promptTokens = this.getTokenCount(promptText, model);
    const requiredTokens = promptTokens + maxCompletionTokens;
    const valid = requiredTokens <= limits.contextWindow;
    const availableTokens = limits.contextWindow - promptTokens;
    
    let suggestedModel: string | undefined;
    
    if (!valid) {
      // Suggest a model with larger context window
      for (const [modelName, modelLimits] of Object.entries(this.MODEL_LIMITS)) {
        if (modelLimits.contextWindow >= requiredTokens) {
          suggestedModel = modelName;
          break;
        }
      }
    }
    
    return {
      valid,
      promptTokens,
      availableTokens,
      suggestedModel
    };
  }
  
  chunkDocument(
    document: string,
    maxChunkTokens: number,
    model: string = 'gpt-4',
    overlap: number = 100
  ): string[] {
    const totalTokens = this.getTokenCount(document, model);
    
    if (totalTokens <= maxChunkTokens) {
      return [document];
    }
    
    const chunks: string[] = [];
    const sentences = document.split(/[.!?]+/).filter(s => s.trim());
    
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = this.getTokenCount(sentence + '.', model);
      
      if (currentTokens + sentenceTokens <= maxChunkTokens) {
        currentChunk += sentence + '.';
        currentTokens += sentenceTokens;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          
          // Add overlap from previous chunk
          if (overlap > 0) {
            const overlapText = this.getLastTokens(currentChunk, overlap, model);
            currentChunk = overlapText + sentence + '.';
            currentTokens = this.getTokenCount(currentChunk, model);
          } else {
            currentChunk = sentence + '.';
            currentTokens = sentenceTokens;
          }
        } else {
          // Single sentence too long, force split
          currentChunk = sentence + '.';
          currentTokens = sentenceTokens;
        }
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  private getLastTokens(text: string, tokenCount: number, model: string): string {
    const encoder = this.getEncoder(model);
    const tokens = encoder.encode(text);
    
    if (tokens.length <= tokenCount) {
      return text;
    }
    
    const lastTokens = tokens.slice(-tokenCount);
    return encoder.decode(lastTokens);
  }
  
  calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
  }, model: string = 'gpt-4'): number {
    const limits = this.MODEL_LIMITS[model];
    if (!limits) return 0;
    
    const promptCost = (usage.promptTokens / 1000) * limits.costPer1kPromptTokens;
    const completionCost = (usage.completionTokens / 1000) * limits.costPer1kCompletionTokens;
    
    return promptCost + completionCost;
  }
  
  selectOptimalModel(
    promptTokens: number,
    estimatedCompletionTokens: number,
    prioritizeCost: boolean = true
  ): string {
    const requiredTokens = promptTokens + estimatedCompletionTokens;
    
    const viableModels = Object.entries(this.MODEL_LIMITS)
      .filter(([_, limits]) => limits.contextWindow >= requiredTokens)
      .map(([model, limits]) => ({
        model,
        limits,
        estimatedCost: this.calculateCost({
          promptTokens,
          completionTokens: estimatedCompletionTokens
        }, model)
      }));
    
    if (viableModels.length === 0) {
      throw new Error(`No model can handle ${requiredTokens} tokens`);
    }
    
    if (prioritizeCost) {
      return viableModels.sort((a, b) => a.estimatedCost - b.estimatedCost)[0].model;
    } else {
      // Prioritize larger context window
      return viableModels.sort((a, b) => b.limits.contextWindow - a.limits.contextWindow)[0].model;
    }
  }
  
  // Cleanup encoders
  dispose() {
    for (const encoder of this.encoders.values()) {
      encoder.free?.();
    }
    this.encoders.clear();
  }
}
```

Update OpenAI service to use token management:
```typescript
// src/services/openai.service.ts
import { TokenManager } from '../utils/token-manager';

export class OpenAIService {
  private client: OpenAI;
  private retryManager = new RetryManager();
  private tokenManager = new TokenManager();
  
  async createCompletion(
    messages: ChatCompletionMessageParam[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } = {}
  ): Promise<{
    completion: OpenAI.Chat.Completions.ChatCompletion;
    usage: TokenUsage;
  }> {
    const {
      model = 'gpt-4',
      temperature = 0.1,
      maxTokens = 4000,
      stream = false
    } = options;
    
    // Calculate prompt tokens
    const promptText = messages.map(m => m.content).join('\n');
    const validation = this.tokenManager.validateContextWindow(
      promptText,
      maxTokens,
      model
    );
    
    if (!validation.valid) {
      if (validation.suggestedModel) {
        console.warn(`Switching to ${validation.suggestedModel} for larger context`);
        return this.createCompletion(messages, {
          ...options,
          model: validation.suggestedModel
        });
      } else {
        throw new Error(
          `Prompt too large: ${validation.promptTokens} tokens exceed model limit`
        );
      }
    }
    
    const operation = async () => {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: Math.min(maxTokens, validation.availableTokens),
        stream,
        user: 'document-optimizer'
      });
      
      const usage = {
        promptTokens: completion.usage?.prompt_tokens || validation.promptTokens,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
        estimatedCost: this.tokenManager.calculateCost({
          promptTokens: completion.usage?.prompt_tokens || validation.promptTokens,
          completionTokens: completion.usage?.completion_tokens || 0
        }, model)
      };
      
      return { completion, usage };
    };
    
    const context = `OpenAI ${model} completion`;
    
    return this.retryManager.executeWithRetry(operation, context, {
      maxAttempts: 3,
      baseDelay: 2000,
      maxDelay: 30000
    });
  }
  
  async processLargeDocument(
    document: string,
    promptTemplate: string,
    model: string = 'gpt-4'
  ): Promise<string[]> {
    const maxChunkTokens = 6000; // Leave room for prompt and completion
    const chunks = this.tokenManager.chunkDocument(document, maxChunkTokens, model);
    
    console.log(`Processing document in ${chunks.length} chunks`);
    
    const results: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkPrompt = promptTemplate.replace('{{DOCUMENT_CONTENT}}', chunks[i]);
      
      const { completion } = await this.createCompletion([
        {
          role: 'user',
          content: chunkPrompt
        }
      ], { model });
      
      const result = completion.choices[0]?.message?.content || '';
      results.push(result);
      
      console.log(`Processed chunk ${i + 1}/${chunks.length}`);
    }
    
    return results;
  }
  
  dispose() {
    this.tokenManager.dispose();
  }
}
```

Add token usage monitoring:
```typescript
// Add to document service
async optimizeDocument(
  document: DocumentInput,
  optimizationType: string
): Promise<OptimizationResult & { tokenUsage: TokenUsage }> {
  // ... existing logic ...
  
  const { completion, usage } = await this.openaiService.createCompletion(
    messages,
    { model: 'gpt-4', temperature: 0.1, maxTokens: 4000 }
  );
  
  // Log token usage
  console.log('Token usage:', {
    document: document.name,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCost: usage.estimatedCost
  });
  
  return {
    originalFilename: document.name,
    optimizedContent: completion.choices[0]?.message?.content || '',
    metadata: {
      // ... existing metadata ...
      tokenUsage: usage
    },
    status: 'fulfilled',
    tokenUsage: usage
  };
}
```

## Definition of Done
- [ ] Accurate token counting works for all models
- [ ] Context window limits are enforced
- [ ] Large documents are chunked automatically
- [ ] Cost estimation is accurate
- [ ] Token usage is logged for monitoring