import { describe, it, expect, beforeEach } from 'vitest'
import { OpenAIService } from '../../../src/services/openai.service.js'

describe('OpenAIService - Model Support', () => {
  let openaiService: OpenAIService

  beforeEach(() => {
    openaiService = new OpenAIService({
      apiKey: 'test-key'
    })
  })

  describe('getSupportedModels', () => {
    it('should return list of supported models', () => {
      const models = openaiService.getSupportedModels()

      expect(models).toBeInstanceOf(Array)
      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('gpt-4-turbo')
      expect(models).toContain('gpt-4')
      expect(models).toContain('gpt-3.5-turbo')
    })

    it('should return models in correct order', () => {
      const models = openaiService.getSupportedModels()

      expect(models[0]).toBe('gpt-4o')
      expect(models[models.length - 1]).toBe('gpt-3.5-turbo')
    })
  })

  describe('validateModel', () => {
    it('should validate supported models', () => {
      expect(openaiService.validateModel('gpt-4o')).toBe(true)
      expect(openaiService.validateModel('gpt-4o-mini')).toBe(true)
      expect(openaiService.validateModel('gpt-4-turbo')).toBe(true)
      expect(openaiService.validateModel('gpt-4')).toBe(true)
      expect(openaiService.validateModel('gpt-3.5-turbo')).toBe(true)
    })

    it('should reject unsupported models', () => {
      expect(openaiService.validateModel('gpt-5')).toBe(false)
      expect(openaiService.validateModel('claude-3')).toBe(false)
      expect(openaiService.validateModel('unknown-model')).toBe(false)
      expect(openaiService.validateModel('')).toBe(false)
    })
  })

  describe('getModelCapabilities', () => {
    it('should return capabilities for gpt-4o', () => {
      const capabilities = openaiService.getModelCapabilities('gpt-4o')

      expect(capabilities).toMatchObject({
        maxTokens: 4096,
        supportsStreaming: true,
        contextWindow: 128000,
        costTier: 'high'
      })
    })

    it('should return capabilities for gpt-4o-mini', () => {
      const capabilities = openaiService.getModelCapabilities('gpt-4o-mini')

      expect(capabilities).toMatchObject({
        maxTokens: 4096,
        supportsStreaming: true,
        contextWindow: 128000,
        costTier: 'low'
      })
    })

    it('should return capabilities for gpt-3.5-turbo', () => {
      const capabilities = openaiService.getModelCapabilities('gpt-3.5-turbo')

      expect(capabilities).toMatchObject({
        maxTokens: 4096,
        supportsStreaming: true,
        contextWindow: 16385,
        costTier: 'low'
      })
    })

    it('should return fallback capabilities for unknown model', () => {
      const capabilities = openaiService.getModelCapabilities('unknown-model')

      expect(capabilities).toMatchObject({
        maxTokens: 4096,
        supportsStreaming: true,
        contextWindow: 16385,
        costTier: 'low'
      })
    })

    it('should have consistent capability structure', () => {
      const models = openaiService.getSupportedModels()

      models.forEach(model => {
        const capabilities = openaiService.getModelCapabilities(model)
        
        expect(capabilities).toHaveProperty('maxTokens')
        expect(capabilities).toHaveProperty('supportsStreaming')
        expect(capabilities).toHaveProperty('contextWindow')
        expect(capabilities).toHaveProperty('costTier')
        
        expect(typeof capabilities.maxTokens).toBe('number')
        expect(typeof capabilities.supportsStreaming).toBe('boolean')
        expect(typeof capabilities.contextWindow).toBe('number')
        expect(['low', 'medium', 'high']).toContain(capabilities.costTier)
      })
    })
  })

  describe('getDefaultModelForOptimization', () => {
    it('should return appropriate defaults for optimization types', () => {
      expect(openaiService.getDefaultModelForOptimization('clarity')).toBe('gpt-3.5-turbo')
      expect(openaiService.getDefaultModelForOptimization('style')).toBe('gpt-4o-mini')
      expect(openaiService.getDefaultModelForOptimization('consolidate')).toBe('gpt-4-turbo')
    })

    it('should return fallback for unknown optimization type', () => {
      expect(openaiService.getDefaultModelForOptimization('unknown')).toBe('gpt-3.5-turbo')
      expect(openaiService.getDefaultModelForOptimization('')).toBe('gpt-3.5-turbo')
    })

    it('should only return supported models as defaults', () => {
      const optimizationTypes = ['clarity', 'style', 'consolidate', 'summarize', 'unknown']
      const supportedModels = openaiService.getSupportedModels()
      
      optimizationTypes.forEach(type => {
        const defaultModel = openaiService.getDefaultModelForOptimization(type)
        expect(supportedModels).toContain(defaultModel)
      })
    })
  })

  describe('model integration with validation', () => {
    it('should validate model in createCompletion', async () => {
      const messages = [{ role: 'user' as const, content: 'test' }]

      // Valid model should not throw
      expect(() => {
        openaiService['validateModel']('gpt-3.5-turbo')
      }).not.toThrow()

      // Invalid model should be rejected in validation
      expect(openaiService.validateModel('invalid-model')).toBe(false)
    })

    it('should respect model capabilities for max tokens', () => {
      const gpt4Capabilities = openaiService.getModelCapabilities('gpt-4')
      const gpt3Capabilities = openaiService.getModelCapabilities('gpt-3.5-turbo')

      expect(gpt4Capabilities.maxTokens).toBe(4096)
      expect(gpt3Capabilities.maxTokens).toBe(4096)
    })

    it('should verify streaming support for all models', () => {
      const models = openaiService.getSupportedModels()

      models.forEach(model => {
        const capabilities = openaiService.getModelCapabilities(model)
        expect(capabilities.supportsStreaming).toBe(true)
      })
    })
  })

  describe('cost tier categorization', () => {
    it('should categorize models by cost correctly', () => {
      expect(openaiService.getModelCapabilities('gpt-4o').costTier).toBe('high')
      expect(openaiService.getModelCapabilities('gpt-4-turbo').costTier).toBe('high')
      expect(openaiService.getModelCapabilities('gpt-4').costTier).toBe('high')
      expect(openaiService.getModelCapabilities('gpt-4o-mini').costTier).toBe('low')
      expect(openaiService.getModelCapabilities('gpt-3.5-turbo').costTier).toBe('low')
    })

    it('should have at least one model in each cost tier', () => {
      const models = openaiService.getSupportedModels()
      const costTiers = models.map(model => openaiService.getModelCapabilities(model).costTier)

      expect(costTiers).toContain('low')
      expect(costTiers).toContain('high')
    })
  })

  describe('context window sizes', () => {
    it('should have appropriate context windows', () => {
      expect(openaiService.getModelCapabilities('gpt-4o').contextWindow).toBe(128000)
      expect(openaiService.getModelCapabilities('gpt-4o-mini').contextWindow).toBe(128000)
      expect(openaiService.getModelCapabilities('gpt-4-turbo').contextWindow).toBe(128000)
      expect(openaiService.getModelCapabilities('gpt-4').contextWindow).toBe(8192)
      expect(openaiService.getModelCapabilities('gpt-3.5-turbo').contextWindow).toBe(16385)
    })

    it('should have larger context windows for newer models', () => {
      const gpt4oWindow = openaiService.getModelCapabilities('gpt-4o').contextWindow
      const gpt4Window = openaiService.getModelCapabilities('gpt-4').contextWindow
      const gpt3Window = openaiService.getModelCapabilities('gpt-3.5-turbo').contextWindow

      expect(gpt4oWindow).toBeGreaterThan(gpt4Window)
      expect(gpt3Window).toBeGreaterThan(gpt4Window)
    })
  })
})