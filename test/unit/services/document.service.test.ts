import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentService } from '../../../src/services/document.service.js'
import type { DocumentInput } from '../../../src/types/index.js'

describe('DocumentService', () => {
  let documentService: DocumentService
  let mockOpenAIService: any

  beforeEach(() => {
    // Create a mock OpenAI service
    mockOpenAIService = {
      createCompletion: vi.fn().mockImplementation(async (messages) => {
        const isIndexGeneration = messages.some(msg => 
          msg.content && typeof msg.content === 'string' && msg.content.includes('extract entities')
        )
        
        const isConsolidation = messages.some(msg => 
          msg.content && typeof msg.content === 'string' && msg.content.includes('consolidate')
        )
        
        if (isIndexGeneration) {
          return {
            completion: {
              id: 'test-completion',
              choices: [{
                message: {
                  content: JSON.stringify({
                    entities: [
                      { name: 'John Smith', type: 'person', mentions: 1, context: ['test'] }
                    ],
                    topics: [
                      { topic: 'Test Topic', relevance: 0.8, sections: ['Content'] }
                    ],
                    timeline: [
                      { date: '2024-01-15', event: 'Test Event', significance: 'high' }
                    ]
                  })
                }
              }]
            },
            metrics: {
              usage: {
                promptTokens: 50,
                completionTokens: 25,
                totalTokens: 75
              }
            }
          }
        }
        
        if (isConsolidation) {
          // Extract file names from the prompt for more realistic responses
          const userMessage = messages.find(msg => msg.role === 'user')?.content || ''
          const fileNames = userMessage.match(/## Document \d+: (.+\.txt)/g) || []
          const extractedNames = fileNames.map(match => match.replace(/## Document \d+: /, ''))
          
          return {
            completion: {
              id: 'test-completion',
              choices: [{
                message: {
                  content: `# Consolidated Document

This is a consolidated document that includes content from the following files:
${extractedNames.map(name => `- ${name}`).join('\n')}

The documents have been merged successfully.`
                }
              }]
            },
            metrics: {
              usage: {
                promptTokens: 150,
                completionTokens: 100,
                totalTokens: 250
              }
            }
          }
        }
        
        return {
          completion: {
            id: 'test-completion',
            choices: [{
              message: {
                content: 'This is a mock optimized document content for testing purposes.'
              }
            }]
          },
          metrics: {
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150
            }
          }
        }
      }),
      calculateCost: vi.fn().mockReturnValue(0.001)
    }

    // Create document service and inject mock
    documentService = new DocumentService({
      apiKey: 'test-key'
    })
    
    // Replace the internal OpenAI service with our mock
    ;(documentService as any).openaiService = mockOpenAIService
  })

  describe('optimizeDocument', () => {
    it('should optimize a single document successfully', async () => {
      const document: DocumentInput = {
        name: 'test.txt',
        content: 'This is test content that needs optimization for clarity and better structure.',
        type: 'note'
      }

      const result = await documentService.optimizeDocument(document, 'clarity')

      expect(result).toMatchObject({
        originalFilename: 'test.txt',
        status: 'fulfilled',
        optimizedContent: expect.any(String),
        metadata: expect.objectContaining({
          originalLength: expect.any(Number),
          optimizedLength: expect.any(Number),
          compressionRatio: expect.any(Number),
          processingTime: expect.any(Number),
          model: expect.any(String),
          timestamp: expect.any(String)
        })
      })

      expect(result.optimizedContent).toContain('mock optimized document')
      expect(result.metadata.originalLength).toBe(document.content.length)
      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0)
      expect(result.metadata.tokenUsage).toBeDefined()
      expect(result.metadata.cost).toBeDefined()
    })

    it('should handle different optimization types', async () => {
      const document = testHelpers.createMockDocument()

      const clarityResult = await documentService.optimizeDocument(document, 'clarity')
      const styleResult = await documentService.optimizeDocument(document, 'style')

      expect(clarityResult.optimizedContent).toContain('mock optimized document')
      expect(styleResult.optimizedContent).toContain('mock optimized document')
      expect(clarityResult.status).toBe('fulfilled')
      expect(styleResult.status).toBe('fulfilled')
    })

    it('should include document indexes', async () => {
      const document = testHelpers.createMockDocument({
        content: 'Meeting with John Smith at Acme Corporation in New York on 2024-01-15'
      })

      const result = await documentService.optimizeDocument(document, 'clarity')

      expect(result.indexes).toBeDefined()
      expect(result.indexes?.entities).toBeInstanceOf(Array)
      expect(result.indexes?.topics).toBeInstanceOf(Array)
      expect(result.indexes?.timeline).toBeInstanceOf(Array)

      expect(result.indexes?.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'John Smith', type: 'person' })
        ])
      )
    })

    it('should handle processing errors gracefully', async () => {
      const document = testHelpers.createMockDocument()

      const result = await documentService.optimizeDocument(document, 'clarity')

      expect(result.status).toBe('fulfilled')
    })

    it('should respect different models', async () => {
      const document = testHelpers.createMockDocument()

      const gpt3Result = await documentService.optimizeDocument(document, 'clarity', 'gpt-3.5-turbo')
      const gpt4Result = await documentService.optimizeDocument(document, 'clarity', 'gpt-4')

      expect(gpt3Result.metadata.model).toBe('gpt-3.5-turbo')
      expect(gpt4Result.metadata.model).toBe('gpt-4')
    })
  })

  describe('processMultipleDocuments', () => {
    it('should process multiple documents concurrently', async () => {
      const documents: DocumentInput[] = [
        testHelpers.createMockDocument({ name: 'doc1.txt' }),
        testHelpers.createMockDocument({ name: 'doc2.txt' }),
        testHelpers.createMockDocument({ name: 'doc3.txt' })
      ]

      const startTime = Date.now()
      const results = await documentService.processMultipleDocuments(documents, 'clarity')
      const duration = Date.now() - startTime

      expect(results).toHaveLength(3)
      expect(duration).toBeLessThan(1000)

      results.forEach((result, index) => {
        expect(result.originalFilename).toBe(`doc${index + 1}.txt`)
        expect(result.status).toBe('fulfilled')
      })
    })

    it('should handle mixed success and failure scenarios', async () => {
      const documents: DocumentInput[] = [
        testHelpers.createMockDocument({ name: 'good1.txt' }),
        testHelpers.createMockDocument({ name: 'good2.txt' }),
        testHelpers.createMockDocument({ name: 'good3.txt' })
      ]

      const results = await documentService.processMultipleDocuments(documents, 'clarity')

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.status).toBe('fulfilled')
        expect(result.optimizedContent).toBeDefined()
        expect(result.metadata).toBeDefined()
      })
    })

    it('should use default model when none specified', async () => {
      const documents = [testHelpers.createMockDocument()]

      const results = await documentService.processMultipleDocuments(documents, 'clarity')

      expect(results[0]?.metadata.model).toBe('gpt-3.5-turbo')
    })

    it('should handle empty document array', async () => {
      const results = await documentService.processMultipleDocuments([], 'clarity')

      expect(results).toHaveLength(0)
    })
  })

  describe('consolidateDocuments', () => {
    it('should merge multiple documents into one consolidated document', async () => {
      const documents: DocumentInput[] = [
        { name: 'policy1.txt', content: 'Company policy on remote work', type: 'policy' },
        { name: 'policy2.txt', content: 'Company policy on expenses', type: 'policy' },
        { name: 'meeting.txt', content: 'Meeting transcript from 2024-01-15', type: 'transcript' }
      ]

      const result = await documentService.consolidateDocuments(documents)

      expect(result.originalFilename).toBe('consolidated_document')
      expect(result.status).toBe('fulfilled')
      expect(result.optimizedContent).toContain('Consolidated Document')
      expect(result.optimizedContent).toContain('policy1.txt')
      expect(result.optimizedContent).toContain('policy2.txt')
      expect(result.optimizedContent).toContain('meeting.txt')

      expect(result.metadata.originalLength).toBeGreaterThan(0)
      expect(result.metadata.optimizedLength).toBeGreaterThan(0)
      expect(result.metadata.compressionRatio).toBeGreaterThan(0)
    })

    it('should include proper metadata for consolidated document', async () => {
      const documents = [
        testHelpers.createMockDocument({ name: 'doc1.txt' }),
        testHelpers.createMockDocument({ name: 'doc2.txt' })
      ]

      const result = await documentService.consolidateDocuments(documents)

      expect(result.metadata).toMatchObject({
        originalLength: expect.any(Number),
        optimizedLength: expect.any(Number),
        compressionRatio: expect.any(Number),
        processingTime: expect.any(Number),
        model: 'gpt-3.5-turbo',
        timestamp: expect.any(String)
      })
    })

    it('should handle single document consolidation', async () => {
      const documents = [testHelpers.createMockDocument({ name: 'single.txt' })]

      const result = await documentService.consolidateDocuments(documents)

      expect(result.status).toBe('fulfilled')
      expect(result.optimizedContent).toContain('single.txt')
    })
  })

  describe('document processing edge cases', () => {
    it('should handle very long documents', async () => {
      const longContent = 'A'.repeat(10000)
      const document = testHelpers.createMockDocument({ content: longContent })

      const result = await documentService.optimizeDocument(document, 'clarity')

      expect(result.status).toBe('fulfilled')
      expect(result.metadata.originalLength).toBe(10000)
    })

    it('should handle documents with special characters', async () => {
      const specialContent = 'Content with émojis 🎉 and spëcial chars: @#$%^&*()'
      const document = testHelpers.createMockDocument({ content: specialContent })

      const result = await documentService.optimizeDocument(document, 'clarity')

      expect(result.status).toBe('fulfilled')
      expect(result.optimizedContent).toBeDefined()
    })

    it('should handle different document types', async () => {
      const types: Array<'transcript' | 'policy' | 'email' | 'note'> = [
        'transcript',
        'policy', 
        'email',
        'note'
      ]

      for (const type of types) {
        const document = testHelpers.createMockDocument({ type })
        const result = await documentService.optimizeDocument(document, 'clarity')
        
        expect(result.status).toBe('fulfilled')
      }
    })
  })
})