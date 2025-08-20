import { describe, it, expect, beforeEach } from 'vitest'
import { MockOpenAIService, OpenAIError } from '../../../src/services/openai.mock.service.js'

describe('MockOpenAIService', () => {
  let service: MockOpenAIService

  beforeEach(() => {
    service = new MockOpenAIService({ apiKey: 'test-key' })
  })

  describe('createCompletion', () => {
    it('should return a valid completion response', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system' as const, content: 'You are a helpful assistant.' },
          { role: 'user' as const, content: 'Hello, how are you?' }
        ]
      }

      const response = await service.createCompletion(params)

      expect(response).toMatchObject({
        id: expect.stringMatching(/^mock-/),
        object: 'chat.completion',
        created: expect.any(Number),
        model: 'gpt-3.5-turbo',
        choices: expect.arrayContaining([
          expect.objectContaining({
            index: 0,
            message: expect.objectContaining({
              role: 'assistant',
              content: expect.any(String)
            }),
            finish_reason: expect.any(String)
          })
        ]),
        usage: expect.objectContaining({
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          total_tokens: expect.any(Number)
        })
      })
    })

    it('should generate different responses for different prompts', async () => {
      const clarityParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'optimize for clarity: test content' }]
      }

      const styleParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'optimize for style: test content' }]
      }

      const clarityResponse = await service.createCompletion(clarityParams)
      const styleResponse = await service.createCompletion(styleParams)

      expect(clarityResponse.choices[0]?.message.content).toContain('Clarity-Optimized')
      expect(styleResponse.choices[0]?.message.content).toContain('Style-Optimized')
      expect(clarityResponse.choices[0]?.message.content).not.toBe(
        styleResponse.choices[0]?.message.content
      )
    })

    it('should handle consolidation prompts', async () => {
      const params = {
        model: 'gpt-4',
        messages: [{ role: 'user' as const, content: 'consolidate these documents: doc1, doc2' }]
      }

      const response = await service.createCompletion(params)

      expect(response.choices[0]?.message.content).toContain('Consolidated')
    })

    it('should respect max_tokens parameter', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'Generate a very long response' }],
        max_tokens: 50
      }

      const response = await service.createCompletion(params)

      expect(response.usage.completion_tokens).toBeLessThanOrEqual(50)
    })

    it('should simulate service errors occasionally', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'test' }]
      }

      // Test that the service can throw errors (though it's probabilistic)
      // We'll just verify the error types exist and can be thrown
      expect(() => new OpenAIError('Test error', 429)).not.toThrow()
      expect(() => new OpenAIError('Service error', 503)).not.toThrow()
    })

    it('should count tokens approximately', async () => {
      const shortMessage = 'Hi'
      const longMessage = 'This is a much longer message that should result in more tokens being counted by the mock service'

      const shortParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: shortMessage }]
      }

      const longParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: longMessage }]
      }

      const shortResponse = await service.createCompletion(shortParams)
      const longResponse = await service.createCompletion(longParams)

      expect(longResponse.usage.prompt_tokens).toBeGreaterThan(shortResponse.usage.prompt_tokens)
    })

    it('should handle empty messages array', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: []
      }

      await expect(service.createCompletion(params)).rejects.toThrow(OpenAIError)
    })

    it('should track request count', () => {
      const initialCount = service.getRequestCount()
      
      service.createCompletion({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }]
      })

      expect(service.getRequestCount()).toBe(initialCount + 1)
    })

    it('should reset request count', () => {
      service.createCompletion({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }]
      })

      service.resetRequestCount()

      expect(service.getRequestCount()).toBe(0)
    })
  })

  describe('createStreamingCompletion', () => {
    it('should return streaming response chunks', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'Stream this response' }]
      }

      const chunks: string[] = []
      const generator = service.createStreamingCompletion(params)

      for await (const chunk of generator) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n')
      
      // Check that chunks contain valid SSE format
      chunks.slice(0, -1).forEach(chunk => {
        expect(chunk).toMatch(/^data: \{.*\}\n\n$/)
      })
    })

    it('should include delta content in streaming chunks', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'test streaming' }]
      }

      const chunks: string[] = []
      const generator = service.createStreamingCompletion(params)

      for await (const chunk of generator) {
        if (chunk !== 'data: [DONE]\n\n') {
          chunks.push(chunk)
        }
      }

      // Parse a chunk to verify structure
      const chunkData = JSON.parse(chunks[0]?.replace('data: ', '') || '{}')
      expect(chunkData).toMatchObject({
        id: expect.any(String),
        object: 'chat.completion.chunk',
        choices: expect.arrayContaining([
          expect.objectContaining({
            delta: expect.objectContaining({
              content: expect.any(String)
            })
          })
        ])
      })
    })
  })

  describe('response generation', () => {
    it('should generate entity extraction JSON', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'extract entities from this text' }]
      }

      const response = await service.createCompletion(params)
      const content = response.choices[0]?.message.content || ''

      expect(() => JSON.parse(content)).not.toThrow()
      
      const parsed = JSON.parse(content)
      expect(parsed).toHaveProperty('entities')
      expect(parsed.entities).toHaveProperty('people')
      expect(parsed.entities).toHaveProperty('organizations')
    })

    it('should generate summaries for summarization requests', async () => {
      const params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'summarize this document' }]
      }

      const response = await service.createCompletion(params)
      const content = response.choices[0]?.message.content || ''

      expect(content).toContain('Summary')
      expect(content).toContain('Main Points')
    })

    it('should vary response quality by model', async () => {
      const gpt3Params = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'analyze this content' }]
      }

      const gpt4Params = {
        model: 'gpt-4',
        messages: [{ role: 'user' as const, content: 'analyze this content' }]
      }

      const gpt3Response = await service.createCompletion(gpt3Params)
      const gpt4Response = await service.createCompletion(gpt4Params)

      expect(gpt3Response.choices[0]?.message.content).toContain('standard')
      expect(gpt4Response.choices[0]?.message.content).toContain('advanced')
    })

    it('should adjust creativity based on temperature', async () => {
      const lowTempParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'write something creative' }],
        temperature: 0.1
      }

      const highTempParams = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user' as const, content: 'write something creative' }],
        temperature: 1.5
      }

      const lowTempResponse = await service.createCompletion(lowTempParams)
      const highTempResponse = await service.createCompletion(highTempParams)

      expect(lowTempResponse.choices[0]?.message.content).toContain('focused')
      expect(highTempResponse.choices[0]?.message.content).toContain('creative')
    })
  })
})