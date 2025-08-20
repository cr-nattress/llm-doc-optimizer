import type {
  DocumentInput,
  OptimizationResult,
  DocumentMetadata,
  DocumentIndexes,
  EntityIndex,
  TopicIndex,
  TimelineEntry,
  OpenAIConfig
} from '../types/index.js'
import { OpenAIService, type CompletionMetrics } from './openai.service.js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat'

export class DocumentService {
  private openaiService: OpenAIService

  constructor(openaiConfig?: OpenAIConfig) {
    this.openaiService = new OpenAIService(openaiConfig)
  }
  async optimizeDocument(
    document: DocumentInput,
    optimizationType: string,
    model: string = 'gpt-3.5-turbo'
  ): Promise<OptimizationResult> {
    const startTime = Date.now()

    try {
      const messages = this.buildOptimizationPrompt(document, optimizationType)
      
      const { completion, metrics } = await this.openaiService.createCompletion(messages, {
        model,
        temperature: 0.1,
        maxTokens: 4000
      })

      const optimizedContent = completion.choices[0]?.message.content || ''
      const indexes = await this.generateIndexes(document.content, model)

      const metadata: DocumentMetadata = {
        originalLength: document.content.length,
        optimizedLength: optimizedContent.length,
        compressionRatio: optimizedContent.length / document.content.length,
        processingTime: Date.now() - startTime,
        model,
        timestamp: new Date().toISOString(),
        tokenUsage: {
          promptTokens: metrics.usage.promptTokens,
          completionTokens: metrics.usage.completionTokens,
          totalTokens: metrics.usage.totalTokens
        },
        cost: this.openaiService.calculateCost(model, metrics.usage)
      }

      return {
        originalFilename: document.name,
        optimizedContent,
        indexes,
        metadata,
        status: 'fulfilled'
      }
    } catch (error) {
      return {
        originalFilename: document.name,
        optimizedContent: '',
        metadata: {
          originalLength: document.content.length,
          optimizedLength: 0,
          compressionRatio: 0,
          processingTime: Date.now() - startTime,
          model,
          timestamp: new Date().toISOString()
        },
        status: 'rejected',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async processMultipleDocuments(
    documents: DocumentInput[],
    optimizationType: string,
    model?: string
  ): Promise<OptimizationResult[]> {
    const selectedModel = model || 'gpt-3.5-turbo'
    const promises = documents.map((doc) =>
      this.optimizeDocument(doc, optimizationType, selectedModel)
    )

    const results = await Promise.allSettled(promises)

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        return {
          originalFilename: documents[index]?.name || 'unknown',
          optimizedContent: '',
          metadata: {
            originalLength: documents[index]?.content.length || 0,
            optimizedLength: 0,
            compressionRatio: 0,
            processingTime: 0,
            model: selectedModel,
            timestamp: new Date().toISOString()
          },
          status: 'rejected' as const,
          error: result.reason instanceof Error ? result.reason.message : 'Processing failed'
        }
      }
    })
  }

  async consolidateDocuments(
    documents: DocumentInput[],
    model: string = 'gpt-3.5-turbo'
  ): Promise<OptimizationResult> {
    const startTime = Date.now()

    try {
      const consolidatedContent = documents
        .map((doc) => `# ${doc.name}\n\n${doc.content}`)
        .join('\n\n---\n\n')

      const messages = this.buildConsolidationPrompt(documents)
      
      const { completion, metrics } = await this.openaiService.createCompletion(messages, {
        model,
        temperature: 0.1,
        maxTokens: 4000
      })

      const optimizedContent = completion.choices[0]?.message.content || ''
      const indexes = await this.generateIndexes(consolidatedContent, model)

      const metadata: DocumentMetadata = {
        originalLength: consolidatedContent.length,
        optimizedLength: optimizedContent.length,
        compressionRatio: optimizedContent.length / consolidatedContent.length,
        processingTime: Date.now() - startTime,
        model,
        timestamp: new Date().toISOString(),
        tokenUsage: {
          promptTokens: metrics.usage.promptTokens,
          completionTokens: metrics.usage.completionTokens,
          totalTokens: metrics.usage.totalTokens
        },
        cost: this.openaiService.calculateCost(model, metrics.usage)
      }

      return {
        originalFilename: 'consolidated_document',
        optimizedContent,
        indexes,
        metadata,
        status: 'fulfilled'
      }
    } catch (error) {
      const consolidatedLength = documents.reduce((sum, doc) => sum + doc.content.length, 0)
      
      return {
        originalFilename: 'consolidated_document',
        optimizedContent: '',
        metadata: {
          originalLength: consolidatedLength,
          optimizedLength: 0,
          compressionRatio: 0,
          processingTime: Date.now() - startTime,
          model,
          timestamp: new Date().toISOString()
        },
        status: 'rejected',
        error: error instanceof Error ? error.message : 'Consolidation failed'
      }
    }
  }

  private buildOptimizationPrompt(document: DocumentInput, optimizationType: string): ChatCompletionMessageParam[] {
    const systemPrompt = this.getSystemPrompt(optimizationType)
    const userPrompt = this.getUserPrompt(document, optimizationType)

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }

  private buildConsolidationPrompt(documents: DocumentInput[]): ChatCompletionMessageParam[] {
    const systemPrompt = `You are an expert document analyst and technical writer. Your task is to consolidate multiple documents into a single, coherent, and well-structured document. 

Key requirements:
- Eliminate redundancy while preserving all important information
- Create logical flow and structure
- Maintain accuracy and context from all source documents
- Provide clear section organization
- Include cross-references where appropriate
- Use professional, clear language`

    const documentSummaries = documents.map((doc, index) => 
      `## Document ${index + 1}: ${doc.name}\n${doc.content}`
    ).join('\n\n---\n\n')

    const userPrompt = `Please consolidate the following ${documents.length} documents into a single, well-structured document:

${documentSummaries}

Requirements:
1. Create a comprehensive consolidated document
2. Eliminate redundant information
3. Maintain all critical details
4. Organize content logically
5. Provide clear headings and structure
6. Include a summary section`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }

  private getSystemPrompt(optimizationType: string): string {
    const basePrompt = "You are an expert document optimizer and technical writer."

    switch (optimizationType) {
      case 'clarity':
        return `${basePrompt} Your task is to optimize documents for maximum clarity and readability. Focus on:
- Simplifying complex language without losing meaning
- Breaking down long sentences
- Converting passive voice to active voice
- Eliminating jargon and redundancy
- Improving logical flow and structure
- Making content accessible to a broader audience`

      case 'style':
        return `${basePrompt} Your task is to optimize documents for consistent professional style. Focus on:
- Maintaining consistent tone and voice throughout
- Standardizing terminology and formatting
- Using professional business language
- Ensuring parallel structure in lists and sections
- Improving readability while maintaining formality
- Creating cohesive flow between sections`

      case 'summarize':
        return `${basePrompt} Your task is to create concise, comprehensive summaries. Focus on:
- Identifying and preserving key information
- Eliminating unnecessary details
- Maintaining context and meaning
- Creating logical structure
- Highlighting actionable items
- Providing clear conclusions`

      default:
        return `${basePrompt} Your task is to optimize the document for improved readability, clarity, and professional presentation.`
    }
  }

  private getUserPrompt(document: DocumentInput, optimizationType: string): string {
    const action = this.getActionVerb(optimizationType)
    
    return `Please ${action} the following document:

**Document Name:** ${document.name}
**Document Type:** ${document.type || 'Unknown'}

**Content:**
${document.content}

**Instructions:**
1. ${action.charAt(0).toUpperCase() + action.slice(1)} the content according to the specified optimization type
2. Maintain all critical information and context
3. Provide clear structure with appropriate headings
4. Ensure the result is professional and polished
5. Return only the optimized content without meta-commentary`
  }

  private getActionVerb(optimizationType: string): string {
    switch (optimizationType) {
      case 'clarity': return 'clarify and improve the readability of'
      case 'style': return 'standardize the style and tone of'
      case 'summarize': return 'summarize'
      case 'consolidate': return 'consolidate'
      default: return 'optimize'
    }
  }

  private async generateIndexes(content: string, model: string): Promise<DocumentIndexes> {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are an expert document analyzer. Extract structured information from documents and return it as valid JSON.

Return a JSON object with this exact structure:
{
  "entities": [
    {
      "name": "string",
      "type": "person|organization|location|product|other",
      "mentions": number,
      "context": ["string"]
    }
  ],
  "topics": [
    {
      "topic": "string",
      "relevance": number_between_0_and_1,
      "sections": ["string"]
    }
  ],
  "timeline": [
    {
      "date": "YYYY-MM-DD",
      "event": "string",
      "significance": "high|medium|low"
    }
  ]
}`
        },
        {
          role: 'user',
          content: `Analyze the following document and extract entities, topics, and timeline information:

${content.substring(0, 2000)}...

Return only valid JSON with the structure specified.`
        }
      ]

      const { completion } = await this.openaiService.createCompletion(messages, {
        model,
        temperature: 0.1,
        maxTokens: 1500
      })

      const jsonContent = completion.choices[0]?.message.content || '{}'
      
      try {
        const parsed = JSON.parse(jsonContent)
        return {
          entities: parsed.entities || [],
          topics: parsed.topics || [],
          timeline: parsed.timeline || []
        }
      } catch {
        // Fallback to basic indexes if JSON parsing fails
        return this.generateFallbackIndexes(content)
      }
    } catch {
      // Fallback to basic indexes if API call fails
      return this.generateFallbackIndexes(content)
    }
  }

  private generateFallbackIndexes(content: string): DocumentIndexes {
    const entities: EntityIndex[] = []
    const topics: TopicIndex[] = [
      {
        topic: 'Document Analysis',
        relevance: 0.8,
        sections: ['Content']
      }
    ]
    const timeline: TimelineEntry[] = []

    return { entities, topics, timeline }
  }

  // Expose circuit breaker status from the underlying OpenAI service
  getCircuitBreakerStatus() {
    return this.openaiService.getCircuitBreakerStatus()
  }

  // Reset circuit breaker
  resetCircuitBreaker(): void {
    this.openaiService.resetCircuitBreaker()
  }
}