# User Story: Add Support for Different GPT Models

## Story
As a product manager, I want support for different GPT models so that users can choose between cost, speed, and capability based on their specific needs.

## Acceptance Criteria
- [ ] Multiple GPT models are supported (GPT-4, GPT-4 Turbo, GPT-3.5)
- [ ] Model selection is configurable per request
- [ ] Automatic fallback to alternative models
- [ ] Cost-performance optimization
- [ ] Model-specific prompt tuning

## Technical Details
Update model configuration:
```typescript
// src/config/models.ts
export interface ModelConfig {
  name: string;
  displayName: string;
  contextWindow: number;
  maxCompletion: number;
  costPer1kPromptTokens: number;
  costPer1kCompletionTokens: number;
  capabilities: {
    reasoning: number;    // 1-10 scale
    speed: number;        // 1-10 scale
    costEfficiency: number; // 1-10 scale
  };
  recommended: {
    clarity: boolean;
    style: boolean;
    consolidate: boolean;
  };
}

export const SUPPORTED_MODELS: Record<string, ModelConfig> = {
  'gpt-3.5-turbo': {
    name: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    contextWindow: 16385,
    maxCompletion: 4096,
    costPer1kPromptTokens: 0.001,
    costPer1kCompletionTokens: 0.002,
    capabilities: {
      reasoning: 7,
      speed: 9,
      costEfficiency: 10
    },
    recommended: {
      clarity: true,
      style: true,
      consolidate: false
    }
  },
  'gpt-4': {
    name: 'gpt-4',
    displayName: 'GPT-4',
    contextWindow: 8192,
    maxCompletion: 4096,
    costPer1kPromptTokens: 0.03,
    costPer1kCompletionTokens: 0.06,
    capabilities: {
      reasoning: 10,
      speed: 5,
      costEfficiency: 4
    },
    recommended: {
      clarity: true,
      style: true,
      consolidate: true
    }
  },
  'gpt-4-turbo': {
    name: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxCompletion: 4096,
    costPer1kPromptTokens: 0.01,
    costPer1kCompletionTokens: 0.03,
    capabilities: {
      reasoning: 10,
      speed: 8,
      costEfficiency: 7
    },
    recommended: {
      clarity: true,
      style: true,
      consolidate: true
    }
  },
  'gpt-4-32k': {
    name: 'gpt-4-32k',
    displayName: 'GPT-4 32k',
    contextWindow: 32768,
    maxCompletion: 4096,
    costPer1kPromptTokens: 0.06,
    costPer1kCompletionTokens: 0.12,
    capabilities: {
      reasoning: 10,
      speed: 4,
      costEfficiency: 3
    },
    recommended: {
      clarity: false,
      style: false,
      consolidate: true
    }
  }
};

export class ModelSelector {
  selectBestModel(
    optimizationType: string,
    documentSize: number,
    priority: 'cost' | 'quality' | 'speed' = 'quality'
  ): string {
    const candidateModels = Object.entries(SUPPORTED_MODELS)
      .filter(([_, config]) => config.recommended[optimizationType as keyof typeof config.recommended])
      .filter(([_, config]) => documentSize <= config.contextWindow * 0.7); // Leave room for completion
    
    if (candidateModels.length === 0) {
      throw new Error(`No suitable model found for ${optimizationType} with ${documentSize} tokens`);
    }
    
    // Score models based on priority
    const scoredModels = candidateModels.map(([modelName, config]) => {
      let score = 0;
      
      switch (priority) {
        case 'cost':
          score = config.capabilities.costEfficiency * 0.6 + 
                  config.capabilities.speed * 0.3 + 
                  config.capabilities.reasoning * 0.1;
          break;
        case 'speed':
          score = config.capabilities.speed * 0.6 + 
                  config.capabilities.costEfficiency * 0.3 + 
                  config.capabilities.reasoning * 0.1;
          break;
        case 'quality':
        default:
          score = config.capabilities.reasoning * 0.6 + 
                  config.capabilities.speed * 0.2 + 
                  config.capabilities.costEfficiency * 0.2;
          break;
      }
      
      return { modelName, config, score };
    });
    
    // Return highest scoring model
    return scoredModels.sort((a, b) => b.score - a.score)[0].modelName;
  }
  
  getFallbackModel(primaryModel: string): string | null {
    const config = SUPPORTED_MODELS[primaryModel];
    if (!config) return null;
    
    // Find model with similar capabilities but different characteristics
    const alternatives = Object.entries(SUPPORTED_MODELS)
      .filter(([name, _]) => name !== primaryModel)
      .sort((a, b) => {
        const scoreA = Math.abs(a[1].capabilities.reasoning - config.capabilities.reasoning) +
                      Math.abs(a[1].capabilities.speed - config.capabilities.speed);
        const scoreB = Math.abs(b[1].capabilities.reasoning - config.capabilities.reasoning) +
                      Math.abs(b[1].capabilities.speed - config.capabilities.speed);
        return scoreA - scoreB;
      });
    
    return alternatives.length > 0 ? alternatives[0][0] : null;
  }
}
```

Create model-specific prompt variations:
```typescript
// src/prompts/model-prompts.ts
export class ModelPrompts {
  static getOptimizedPrompt(
    basePrompt: string,
    model: string,
    optimizationType: string
  ): string {
    const config = SUPPORTED_MODELS[model];
    if (!config) return basePrompt;
    
    // Adjust prompt based on model capabilities
    if (model.includes('gpt-3.5')) {
      return this.simplifyPromptForGPT35(basePrompt, optimizationType);
    } else if (model.includes('gpt-4')) {
      return this.enhancePromptForGPT4(basePrompt, optimizationType);
    }
    
    return basePrompt;
  }
  
  private static simplifyPromptForGPT35(
    prompt: string, 
    optimizationType: string
  ): string {
    // GPT-3.5 works better with more direct, simpler instructions
    let simplified = prompt
      .replace(/Instructions:\n/g, '')
      .replace(/\d+\. /g, '- '); // Bullet points instead of numbered lists
    
    if (optimizationType === 'clarity') {
      simplified += '\n\nFocus on the most important information only. Be concise.';
    }
    
    return simplified;
  }
  
  private static enhancePromptForGPT4(
    prompt: string, 
    optimizationType: string
  ): string {
    // GPT-4 can handle more complex instructions and reasoning
    if (optimizationType === 'consolidate') {
      prompt += `\n\nAdditional requirements:
      - Analyze document relationships and dependencies
      - Create cross-references between related sections
      - Identify potential conflicts or contradictions
      - Suggest organizational improvements`;
    }
    
    return prompt;
  }
}
```

Update document service with model selection:
```typescript
// src/services/document.service.ts
export class DocumentService {
  private modelSelector = new ModelSelector();
  
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string,
    options: {
      preferredModel?: string;
      priority?: 'cost' | 'quality' | 'speed';
      allowFallback?: boolean;
    } = {}
  ): Promise<OptimizationResult> {
    const documentTokens = this.tokenManager.getTokenCount(document.content);
    
    // Select best model if none specified
    let selectedModel = options.preferredModel || 
      this.modelSelector.selectBestModel(
        optimizationType,
        documentTokens,
        options.priority || 'quality'
      );
    
    // Validate model can handle document
    const validation = this.tokenManager.validateContextWindow(
      document.content,
      4000,
      selectedModel
    );
    
    if (!validation.valid && options.allowFallback !== false) {
      const fallback = this.modelSelector.getFallbackModel(selectedModel);
      if (fallback) {
        console.log(`Falling back from ${selectedModel} to ${fallback}`);
        selectedModel = fallback;
      }
    }
    
    // Get model-optimized prompt
    const basePrompt = this.getPromptTemplate(optimizationType);
    const optimizedPrompt = ModelPrompts.getOptimizedPrompt(
      basePrompt,
      selectedModel,
      optimizationType
    );
    
    const prompt = PromptTemplates.interpolate(optimizedPrompt, {
      DOCUMENT_TYPE: document.type || 'document',
      DOCUMENT_NAME: document.name,
      DOCUMENT_CONTENT: document.content
    });
    
    try {
      const { completion, usage } = await this.openaiService.createCompletion([
        {
          role: 'system',
          content: 'You are a professional document optimizer.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model: selectedModel,
        temperature: this.getOptimalTemperature(selectedModel, optimizationType),
        maxTokens: 4000
      });
      
      return {
        originalFilename: document.name,
        optimizedContent: completion.choices[0]?.message?.content || '',
        metadata: {
          originalLength: document.content.length,
          optimizedLength: completion.choices[0]?.message?.content?.length || 0,
          processingTime: Date.now() - Date.now(), // This should be tracked properly
          tokenCount: usage.totalTokens,
          model: selectedModel,
          estimatedCost: usage.estimatedCost,
          entities: [],
          topics: []
        },
        status: 'fulfilled'
      };
    } catch (error) {
      // Try fallback model if allowed
      if (options.allowFallback !== false) {
        const fallback = this.modelSelector.getFallbackModel(selectedModel);
        if (fallback && fallback !== selectedModel) {
          console.warn(`Primary model ${selectedModel} failed, trying ${fallback}`);
          return this.optimizeDocument(document, optimizationType, {
            ...options,
            preferredModel: fallback,
            allowFallback: false // Prevent infinite recursion
          });
        }
      }
      
      throw error;
    }
  }
  
  private getOptimalTemperature(model: string, optimizationType: string): number {
    // Different models and tasks may benefit from different temperatures
    const baseTemp = optimizationType === 'style' ? 0.3 : 0.1;
    
    if (model.includes('gpt-3.5')) {
      return baseTemp + 0.1; // Slightly higher for more creativity
    }
    
    return baseTemp;
  }
}
```

Add model selection to API:
```typescript
// Update request schema to include model preference
const optimizationRequestSchema = {
  type: 'object',
  required: ['documents', 'optimizationType'],
  properties: {
    documents: { /* ... existing ... */ },
    optimizationType: { /* ... existing ... */ },
    mode: { /* ... existing ... */ },
    modelPreference: {
      type: 'string',
      enum: Object.keys(SUPPORTED_MODELS)
    },
    priority: {
      type: 'string',
      enum: ['cost', 'quality', 'speed'],
      default: 'quality'
    }
  }
};

// Add endpoint to list available models
app.get('/models', async (request, reply) => {
  return {
    models: Object.entries(SUPPORTED_MODELS).map(([name, config]) => ({
      name,
      displayName: config.displayName,
      capabilities: config.capabilities,
      contextWindow: config.contextWindow,
      recommended: config.recommended
    }))
  };
});
```

## Definition of Done
- [ ] Multiple GPT models are supported
- [ ] Model selection logic chooses optimal model
- [ ] Automatic fallback works for failures
- [ ] Model-specific prompts improve results
- [ ] API exposes model selection options