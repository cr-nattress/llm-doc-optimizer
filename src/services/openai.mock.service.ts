import type { OpenAIConfig } from '../types/index.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: ChatMessage
    finish_reason: 'stop' | 'length' | 'content_filter' | null
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message)
    this.name = 'OpenAIError'
  }
}

export class MockOpenAIService {
  private config: OpenAIConfig
  private requestCount = 0

  constructor(config: OpenAIConfig) {
    this.config = config
  }

  async createCompletion(params: {
    model: string
    messages: ChatMessage[]
    temperature?: number
    max_tokens?: number
    stream?: boolean
  }): Promise<ChatCompletionResponse> {
    this.requestCount++

    await this.simulateLatency()

    // Disable random errors in test environment
    if (process.env.NODE_ENV !== 'test') {
      if (Math.random() < 0.05) {
        throw new OpenAIError('Rate limit exceeded', 429, 'rate_limit_exceeded')
      }

      if (Math.random() < 0.02) {
        throw new OpenAIError('Service temporarily unavailable', 503, 'service_unavailable')
      }
    }

    const lastMessage = params.messages[params.messages.length - 1]
    if (!lastMessage) {
      throw new OpenAIError('No messages provided', 400, 'invalid_request')
    }

    const prompt = lastMessage.content
    const response = this.generateMockResponse(
      prompt,
      params.model,
      params.temperature || 0.7
    )

    const maxTokens = params.max_tokens || 2000
    const truncatedResponse =
      response.length > maxTokens * 4 ? response.substring(0, maxTokens * 4) : response

    return {
      id: `mock-${Date.now()}-${this.requestCount}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: truncatedResponse
          },
          finish_reason: response.length > maxTokens * 4 ? 'length' : 'stop'
        }
      ],
      usage: {
        prompt_tokens: this.countTokens(prompt),
        completion_tokens: this.countTokens(truncatedResponse),
        total_tokens: this.countTokens(prompt + truncatedResponse)
      }
    }
  }

  async *createStreamingCompletion(params: {
    model: string
    messages: ChatMessage[]
    temperature?: number
    max_tokens?: number
  }): AsyncGenerator<string, void, unknown> {
    const response = await this.createCompletion({ ...params, stream: false })
    const content = response.choices[0]?.message.content || ''

    const chunks = this.splitIntoChunks(content, 10)

    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      yield `data: ${JSON.stringify({
        id: response.id,
        object: 'chat.completion.chunk',
        created: response.created,
        model: response.model,
        choices: [
          {
            index: 0,
            delta: { content: chunk },
            finish_reason: null
          }
        ]
      })}\n\n`
    }

    yield 'data: [DONE]\n\n'
  }

  private generateMockResponse(prompt: string, model: string, temperature: number): string {
    const promptLower = prompt.toLowerCase()

    if (promptLower.includes('optimize') && promptLower.includes('clarity')) {
      return this.getMockClarityOptimizedDocument()
    }

    if (promptLower.includes('optimize') && promptLower.includes('style')) {
      return this.getMockStyleOptimizedDocument()
    }

    if (promptLower.includes('consolidate')) {
      return this.getMockConsolidatedDocument()
    }

    if (promptLower.includes('summarize')) {
      return this.getMockSummary()
    }

    if (promptLower.includes('extract') && promptLower.includes('entities')) {
      return this.getMockEntityExtraction()
    }

    const modelQuality = model.includes('gpt-4') ? 'advanced' : 'standard'
    const creativity = temperature > 0.7 ? 'creative' : 'focused'

    return `# Mock ${modelQuality} Response (${creativity} mode)

## Analysis
Based on the provided content, here's a comprehensive analysis:

### Key Points
1. The document appears to focus on ${this.extractTopic(prompt)}
2. Several important aspects have been identified
3. Recommendations have been formulated based on best practices

### Detailed Response
${prompt.substring(0, 200)}...

[This is a mock response generated for testing purposes. In production, this would be replaced with actual AI-generated content from the ${model} model.]

### Recommendations
- Consider implementing the suggested optimizations
- Review the identified patterns
- Apply the proposed structure

### Conclusion
The document has been processed successfully using mock ${model} with temperature ${temperature}.`
  }

  private getMockClarityOptimizedDocument(): string {
    return `# Clarity-Optimized Document

## Executive Summary
This document has been restructured for maximum clarity and comprehension.

## Core Objectives
1. **Primary Goal**: Achieve clear communication of complex concepts
2. **Secondary Goal**: Reduce ambiguity and improve readability
3. **Tertiary Goal**: Maintain technical accuracy while simplifying language

## Key Information

### Section 1: Background
The original document contained several areas of potential confusion that have been addressed:
- Technical jargon has been replaced with plain language
- Complex sentences have been broken down
- Passive voice has been converted to active voice

### Section 2: Main Content
**Important:** All critical information has been preserved while improving presentation.

The document now follows a logical flow:
1. Introduction to the topic
2. Explanation of key concepts
3. Practical applications
4. Conclusions and next steps

### Section 3: Action Items
- [ ] Review the optimized content
- [ ] Verify technical accuracy
- [ ] Approve for distribution

## Metrics
- Readability Score: Improved from 45 to 78 (Flesch Reading Ease)
- Average Sentence Length: Reduced from 28 to 15 words
- Jargon Density: Decreased by 65%

## Conclusion
The document is now optimized for clarity while maintaining all essential information.`
  }

  private getMockStyleOptimizedDocument(): string {
    return `# Style-Optimized Document

## Professional Summary
*This document has been refined to reflect a consistent, professional tone throughout.*

### Introduction
We are pleased to present this style-optimized version of your document, crafted to maintain consistency in voice, tone, and formatting.

### Content Overview
The document has undergone comprehensive stylistic improvements:

**Tone Consistency**
- Formal business language applied uniformly
- Active voice prioritized throughout
- Professional terminology standardized

**Structural Enhancements**
- Parallel construction in all lists
- Consistent heading hierarchy
- Unified paragraph structure

### Key Improvements Implemented

1. **Language Refinement**
   - Eliminated colloquialisms
   - Standardized technical terms
   - Enhanced professional vocabulary

2. **Format Standardization**
   - Consistent bullet point usage
   - Uniform spacing and indentation
   - Standardized citation format

3. **Flow Optimization**
   - Improved transitional phrases
   - Logical section progression
   - Enhanced readability flow

### Quality Metrics
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Style Consistency | 62% | 94% | +32% |
| Professional Tone | 71% | 96% | +25% |
| Format Uniformity | 68% | 98% | +30% |

### Recommendations
Moving forward, we recommend maintaining these stylistic standards for all related documentation.

### Conclusion
The document now exemplifies professional communication standards suitable for executive-level presentation.`
  }

  private getMockConsolidatedDocument(): string {
    return `# Consolidated Master Document

## Executive Overview
*Multiple source documents have been intelligently merged into this comprehensive resource.*

## Document Integration Summary
- **Source Documents**: 3 files processed
- **Total Content**: 15,000 words consolidated to 8,000 words
- **Redundancy Eliminated**: 47% reduction achieved
- **Key Themes Identified**: 5 primary topics

## Unified Content Structure

### Part I: Combined Introduction
Information from all source documents has been synthesized to provide a comprehensive overview without repetition.

### Part II: Core Content

#### Chapter 1: Foundational Concepts
*Merged from Documents A and B*

Key principles that appear across multiple sources:
- Principle 1 (mentioned in all documents)
- Principle 2 (Documents A and C)
- Principle 3 (Documents B and C)

#### Chapter 2: Detailed Analysis
*Consolidated from all sources*

Comprehensive analysis combining insights from:
1. Document A's technical perspective
2. Document B's business implications
3. Document C's implementation guidelines

#### Chapter 3: Unified Recommendations
*Synthesized from all source recommendations*

### Part III: Integrated Conclusions

## Cross-Reference Matrix
| Topic | Doc A | Doc B | Doc C | Consolidated Section |
|-------|-------|-------|-------|---------------------|
| Strategy | §2.1 | §1.3 | §4.2 | Chapter 1.2 |
| Implementation | §3.1 | §2.4 | §5.1 | Chapter 2.3 |
| Metrics | §4.2 | §3.2 | §6.3 | Chapter 3.1 |

## Appendices
- Appendix A: Source Document Mapping
- Appendix B: Eliminated Redundancies
- Appendix C: Conflict Resolutions

## Meta Information
- Consolidation Date: ${new Date().toISOString()}
- Processing Method: Intelligent Document Merge
- Retention Rate: 53% of original content`
  }

  private getMockSummary(): string {
    return `# Document Summary

## Quick Overview
This document contains important information that has been condensed into key takeaways.

## Main Points
1. Critical finding #1 with supporting evidence
2. Important observation #2 and its implications
3. Key recommendation #3 for immediate action

## Details
The original document spans multiple topics, with the most significant being organizational efficiency and process optimization.

## Recommendations
- Immediate: Address the identified gaps
- Short-term: Implement proposed solutions
- Long-term: Monitor and adjust strategies

## Conclusion
Summary successfully generated with 75% content reduction while maintaining all critical information.`
  }

  private getMockEntityExtraction(): string {
    return JSON.stringify(
      {
        entities: {
          people: ['John Smith', 'Jane Doe', 'Robert Johnson'],
          organizations: ['Acme Corp', 'Global Solutions Inc', 'Tech Innovations LLC'],
          locations: ['New York', 'San Francisco', 'London'],
          dates: ['2024-01-15', '2024-02-28', '2024-03-30'],
          monetary_values: ['$1.5M', '$500K', '$2.3M'],
          products: ['Product Alpha', 'Service Beta', 'Platform Gamma']
        },
        relationships: [
          {
            subject: 'John Smith',
            relation: 'works_for',
            object: 'Acme Corp'
          },
          {
            subject: 'Acme Corp',
            relation: 'partnered_with',
            object: 'Global Solutions Inc'
          }
        ],
        key_metrics: {
          total_entities: 15,
          confidence_score: 0.92
        }
      },
      null,
      2
    )
  }

  private extractTopic(prompt: string): string {
    const topics = [
      'business strategy',
      'technical documentation',
      'policy compliance',
      'project management',
      'financial analysis'
    ]
    return topics[Math.floor(Math.random() * topics.length)] || 'general content'
  }

  private simulateLatency(): Promise<void> {
    const baseDelay = 200
    const variableDelay = Math.random() * 300
    const totalDelay = baseDelay + variableDelay

    return new Promise((resolve) => setTimeout(resolve, totalDelay))
  }

  private countTokens(text: string): number {
    const averageCharsPerToken = 4
    return Math.floor(text.length / averageCharsPerToken)
  }

  private splitIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = []
    const words = text.split(' ')

    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' ') + ' ')
    }

    return chunks
  }

  getRequestCount(): number {
    return this.requestCount
  }

  resetRequestCount(): void {
    this.requestCount = 0
  }
}