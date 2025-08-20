# User Story: Implement Mock OpenAI Service

## Story
As a developer, I want a mock OpenAI service that simulates API responses so that I can develop without incurring API costs or requiring credentials.

## Acceptance Criteria
- [ ] Mock service implements same interface as real OpenAI client
- [ ] Returns realistic GPT-like responses
- [ ] Simulates different response scenarios (success, error, timeout)
- [ ] Respects different model parameters
- [ ] Includes mock token counting

## Technical Details
Create src/services/openai.mock.service.ts:
```typescript
export class MockOpenAIService {
  async createCompletion(params: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<ChatCompletionResponse> {
    // Simulate API delay
    await this.simulateLatency();
    
    // Randomly simulate errors for testing
    if (Math.random() < 0.1) {
      throw new OpenAIError('Rate limit exceeded', 429);
    }
    
    const prompt = params.messages[params.messages.length - 1].content;
    const response = this.generateMockResponse(prompt, params.model);
    
    return {
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      created: Date.now(),
      model: params.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: this.countTokens(prompt),
        completion_tokens: this.countTokens(response),
        total_tokens: this.countTokens(prompt + response)
      }
    };
  }
  
  private generateMockResponse(prompt: string, model: string): string {
    if (prompt.includes('optimize')) {
      return this.getMockOptimizedDocument();
    }
    if (prompt.includes('consolidate')) {
      return this.getMockConsolidatedDocument();
    }
    return 'Mock response for: ' + prompt.substring(0, 50);
  }
  
  private simulateLatency(): Promise<void> {
    const delay = 200 + Math.random() * 300;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
  
  private countTokens(text: string): number {
    return Math.floor(text.length / 4);
  }
}
```

## Definition of Done
- [ ] Mock service mimics OpenAI API structure
- [ ] Different prompts return appropriate responses
- [ ] Error scenarios are randomly triggered
- [ ] Token counting approximates real usage