import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat'
import type { OpenAIConfig } from '../types/index.js'
import { ExternalServiceError } from '../middleware/error-handler.js'
import { RetryManager } from '../utils/retry.js'

export interface OpenAICompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  user?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CompletionMetrics {
  model: string
  usage: TokenUsage
  duration: number
  requestId?: string
}

export class OpenAIService {
  private client: OpenAI
  private requestCount = 0
  private totalTokensUsed = 0
  private retryManager = new RetryManager()

  constructor(config?: OpenAIConfig) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.')
    }

    this.client = new OpenAI({
      apiKey,
      organization: config?.organization || process.env.OPENAI_ORGANIZATION,
      baseURL: config?.baseURL,
      timeout: config?.timeout || 60000, // 60 seconds
      maxRetries: config?.maxRetries || 3
    })
  }

  async validateConnection(): Promise<boolean> {
    try {
      console.log('🔍 Validating OpenAI connection...')
      await this.client.models.list()
      console.log('✅ OpenAI connection validated successfully')
      return true
    } catch (error) {
      console.error('❌ OpenAI connection validation failed:', this.extractErrorMessage(error))
      return false
    }
  }

  async createCompletion(
    messages: ChatCompletionMessageParam[],
    options: OpenAICompletionOptions = {}
  ): Promise<{
    completion: OpenAI.Chat.Completions.ChatCompletion
    metrics: CompletionMetrics
  }> {
    const startTime = Date.now()
    
    const {
      model = 'gpt-3.5-turbo',
      temperature = 0.1,
      maxTokens = 4000,
      stream = false,
      user = 'llm-doc-optimizer'
    } = options

    // Validate inputs
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty')
    }

    if (temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be between 0 and 2')
    }

    if (maxTokens < 1 || maxTokens > 8000) {
      throw new Error('Max tokens must be between 1 and 8000')
    }

    const operation = async (): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
      this.requestCount++
      console.log(`🤖 Creating OpenAI completion (model: ${model}, tokens: ${maxTokens})`)

      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false, // Ensure stream is false for non-streaming calls
        user,
        response_format: { type: 'text' }
      }) as OpenAI.Chat.Completions.ChatCompletion

      const usage = completion.usage
      if (usage) {
        this.totalTokensUsed += usage.total_tokens
      }

      return completion
    }

    const context = `OpenAI ${model} completion`
    
    try {
      const completion = await this.retryManager.executeWithRetry(operation, context, {
        maxAttempts: 3,
        baseDelay: 2000,
        maxDelay: 30000
      })

      const duration = Date.now() - startTime
      const usage = completion.usage

      const metrics: CompletionMetrics = {
        model,
        usage: {
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0
        },
        duration,
        requestId: completion.id
      }

      console.log(`✅ Completion created (${duration}ms, ${metrics.usage.totalTokens} tokens)`)

      return { completion, metrics }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`❌ OpenAI completion failed after ${duration}ms:`, this.extractErrorMessage(error))
      
      this.handleOpenAIError(error)
      throw error
    }
  }

  async createStreamingCompletion(
    messages: ChatCompletionMessageParam[],
    options: OpenAICompletionOptions = {}
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const {
      model = 'gpt-3.5-turbo',
      temperature = 0.1,
      maxTokens = 4000,
      user = 'llm-doc-optimizer'
    } = options

    const operation = async (): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> => {
      this.requestCount++
      console.log(`🌊 Creating streaming completion (model: ${model})`)

      const stream = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        user
      }) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      return stream
    }

    const context = `OpenAI ${model} streaming completion`

    try {
      return await this.retryManager.executeWithRetry(operation, context, {
        maxAttempts: 2, // Fewer retries for streaming to avoid long delays
        baseDelay: 1000,
        maxDelay: 10000
      })
    } catch (error) {
      console.error('❌ Streaming completion failed:', this.extractErrorMessage(error))
      this.handleOpenAIError(error)
      throw error
    }
  }

  async listModels(): Promise<OpenAI.Models.Model[]> {
    const operation = async () => {
      const response = await this.client.models.list()
      return response.data.filter(model => 
        model.id.includes('gpt') || 
        model.id.includes('text-davinci') ||
        model.id.includes('claude')
      )
    }

    const context = 'OpenAI list models'

    try {
      return await this.retryManager.executeWithRetry(operation, context, {
        maxAttempts: 2,
        baseDelay: 1000,
        maxDelay: 5000
      })
    } catch (error) {
      this.handleOpenAIError(error)
      throw error
    }
  }

  estimateTokens(text: string): number {
    // GPT tokenizer approximation: ~4 characters per token for English
    // This is a rough estimate - for precise counting, use tiktoken library
    return Math.ceil(text.length / 4)
  }

  calculateCost(model: string, usage: TokenUsage): number {
    // Pricing as of 2024 (per 1K tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-3.5-turbo-1106': { input: 0.001, output: 0.002 }
    }

    const modelPricing = pricing[model] || pricing['gpt-3.5-turbo']!
    
    const inputCost = (usage.promptTokens / 1000) * modelPricing.input
    const outputCost = (usage.completionTokens / 1000) * modelPricing.output
    
    return inputCost + outputCost
  }

  getUsageStats(): {
    requestCount: number
    totalTokensUsed: number
    estimatedCost: number
  } {
    return {
      requestCount: this.requestCount,
      totalTokensUsed: this.totalTokensUsed,
      estimatedCost: this.totalTokensUsed * 0.002 // Rough average cost per token
    }
  }

  resetStats(): void {
    this.requestCount = 0
    this.totalTokensUsed = 0
  }

  // Get circuit breaker status
  getCircuitBreakerStatus() {
    return this.retryManager.getStatus()
  }

  // Reset circuit breaker (useful for recovery or testing)
  resetCircuitBreaker(): void {
    this.retryManager.reset()
  }

  private handleOpenAIError(error: unknown): void {
    if (error instanceof OpenAI.APIError) {
      const errorInfo = {
        status: error.status,
        code: error.code,
        message: error.message,
        type: error.type,
        param: (error as any).param
      }

      console.error('🚨 OpenAI API Error:', errorInfo)

      // Convert to our error types for better handling
      if (error.status === 401) {
        throw new ExternalServiceError('OpenAI: Invalid API key', error)
      } else if (error.status === 429) {
        throw new ExternalServiceError('OpenAI: Rate limit exceeded', error)
      } else if (error.status === 500) {
        throw new ExternalServiceError('OpenAI: Server error', error)
      } else if (error.status === 503) {
        throw new ExternalServiceError('OpenAI: Service unavailable', error)
      } else {
        throw new ExternalServiceError(`OpenAI: ${error.message}`, error)
      }
    } else if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new ExternalServiceError('OpenAI: Request timeout', error)
      } else if (error.message.includes('network')) {
        throw new ExternalServiceError('OpenAI: Network error', error)
      } else {
        throw new ExternalServiceError(`OpenAI: ${error.message}`, error)
      }
    } else {
      throw new ExternalServiceError('OpenAI: Unknown error occurred', new Error(String(error)))
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof OpenAI.APIError) {
      return `${error.status}: ${error.message}`
    } else if (error instanceof Error) {
      return error.message
    } else {
      return String(error)
    }
  }
}

// Factory function for dependency injection
export function createOpenAIService(config?: OpenAIConfig): OpenAIService {
  return new OpenAIService(config)
}