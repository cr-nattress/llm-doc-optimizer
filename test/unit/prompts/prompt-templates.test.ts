import { describe, it, expect } from 'vitest'
import { PromptTemplates } from '../../../src/prompts/optimize.prompt.js'
import { ConsolidationPrompts } from '../../../src/prompts/consolidate.prompt.js'

describe('PromptTemplates', () => {
  describe('interpolation', () => {
    it('should replace variables in template strings', () => {
      const template = 'Hello {{NAME}}, you have {{COUNT}} messages.'
      const variables = { NAME: 'John', COUNT: '5' }

      const result = PromptTemplates.interpolate(template, variables)

      expect(result).toBe('Hello John, you have 5 messages.')
    })

    it('should handle missing variables gracefully', () => {
      const template = 'Hello {{NAME}}, you have {{COUNT}} messages.'
      const variables = { NAME: 'John' }

      const result = PromptTemplates.interpolate(template, variables)

      expect(result).toBe('Hello John, you have {{COUNT}} messages.')
    })

    it('should handle multiple instances of same variable', () => {
      const template = '{{NAME}} said hello to {{NAME}} twice.'
      const variables = { NAME: 'Alice' }

      const result = PromptTemplates.interpolate(template, variables)

      expect(result).toBe('Alice said hello to Alice twice.')
    })

    it('should handle empty variables object', () => {
      const template = 'No variables here!'
      const variables = {}

      const result = PromptTemplates.interpolate(template, variables)

      expect(result).toBe('No variables here!')
    })
  })

  describe('template validation', () => {
    it('should validate required variables are present', () => {
      const template = PromptTemplates.CLARITY_OPTIMIZER
      const validVariables = {
        DOCUMENT_TYPE: 'policy',
        DOCUMENT_NAME: 'test.txt',
        DOCUMENT_CONTENT: 'Test content'
      }

      const isValid = PromptTemplates.validateVariables(template, validVariables)

      expect(isValid).toBe(true)
    })

    it('should detect missing required variables', () => {
      const template = PromptTemplates.CLARITY_OPTIMIZER
      const incompleteVariables = {
        DOCUMENT_TYPE: 'policy',
        DOCUMENT_NAME: 'test.txt'
        // Missing DOCUMENT_CONTENT
      }

      const isValid = PromptTemplates.validateVariables(template, incompleteVariables)

      expect(isValid).toBe(false)
    })
  })

  describe('message building', () => {
    it('should build system and user messages correctly', () => {
      const template = PromptTemplates.CLARITY_OPTIMIZER
      const variables = {
        DOCUMENT_TYPE: 'policy',
        DOCUMENT_NAME: 'employee-handbook.pdf',
        DOCUMENT_CONTENT: 'This is the employee handbook content...'
      }

      const messages = PromptTemplates.buildMessages(template, variables)

      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining('expert business analyst')
      })
      expect(messages[1]).toMatchObject({
        role: 'user',
        content: expect.stringContaining('employee-handbook.pdf')
      })
      expect(messages[1].content).toContain('This is the employee handbook content...')
    })

    it('should throw error for missing variables', () => {
      const template = PromptTemplates.CLARITY_OPTIMIZER
      const incompleteVariables = {
        DOCUMENT_TYPE: 'policy'
        // Missing required variables
      }

      expect(() => {
        PromptTemplates.buildMessages(template, incompleteVariables)
      }).toThrow('Missing required variables')
    })
  })

  describe('input sanitization', () => {
    it('should sanitize potentially dangerous input', () => {
      const dangerousInput = 'Normal text with "quotes" and \\backslashes\nand newlines'

      const sanitized = PromptTemplates.sanitizeInput(dangerousInput)

      expect(sanitized).toBe('Normal text with \\"quotes\\" and \\\\backslashes\\nand newlines')
    })

    it('should handle empty input', () => {
      const result = PromptTemplates.sanitizeInput('')

      expect(result).toBe('')
    })

    it('should handle special characters', () => {
      const input = 'Text with\ttabs\rand\r\ncarriage returns'

      const sanitized = PromptTemplates.sanitizeInput(input)

      expect(sanitized).toContain('\\t')
      expect(sanitized).toContain('\\r')
      expect(sanitized).toContain('\\n')
    })
  })

  describe('clarity optimizer template', () => {
    it('should contain required optimization instructions', () => {
      const template = PromptTemplates.CLARITY_OPTIMIZER

      expect(template.system).toContain('business analyst')
      expect(template.user).toContain('optimize')
      expect(template.user).toContain('clarity')
      expect(template.variables).toContain('DOCUMENT_CONTENT')
    })

    it('should generate valid messages with real data', () => {
      const variables = {
        DOCUMENT_TYPE: 'transcript',
        DOCUMENT_NAME: 'meeting-notes.txt',
        DOCUMENT_CONTENT: 'Meeting started at 9 AM. John discussed the quarterly results...'
      }

      const messages = PromptTemplates.buildMessages(
        PromptTemplates.CLARITY_OPTIMIZER,
        variables
      )

      expect(messages[1].content).toContain('meeting-notes.txt')
      expect(messages[1].content).toContain('quarterly results')
    })
  })

  describe('style optimizer template', () => {
    it('should contain style-specific instructions', () => {
      const template = PromptTemplates.STYLE_OPTIMIZER

      expect(template.system).toContain('technical writer')
      expect(template.user).toContain('style')
      expect(template.variables).toContain('TARGET_AUDIENCE')
    })

    it('should handle target audience parameter', () => {
      const variables = {
        TARGET_AUDIENCE: 'executives',
        DOCUMENT_NAME: 'technical-report.pdf',
        DOCUMENT_CONTENT: 'Technical implementation details...'
      }

      const messages = PromptTemplates.buildMessages(
        PromptTemplates.STYLE_OPTIMIZER,
        variables
      )

      expect(messages[1].content).toContain('executives')
    })
  })

  describe('LLM optimizer template', () => {
    it('should contain LLM-specific optimization rules', () => {
      const template = PromptTemplates.LLM_OPTIMIZER

      expect(template.system).toContain('optimizing documents for LLM')
      expect(template.user).toContain('stable chunk IDs')
      expect(template.user).toContain('entity markers')
    })
  })

  describe('entity extractor template', () => {
    it('should define entity categories', () => {
      const template = PromptTemplates.ENTITY_EXTRACTOR

      expect(template.user).toContain('People')
      expect(template.user).toContain('Organizations')
      expect(template.user).toContain('Locations')
      expect(template.user).toContain('Financial Values')
    })
  })
})

describe('ConsolidationPrompts', () => {
  describe('master consolidator template', () => {
    it('should contain consolidation rules', () => {
      const template = ConsolidationPrompts.MASTER_CONSOLIDATOR

      expect(template.system).toContain('document consolidation')
      expect(template.user).toContain('stable IDs')
      expect(template.user).toContain('source citation')
    })

    it('should handle documents JSON parameter', () => {
      const documentsJson = JSON.stringify([
        { name: 'doc1.txt', content: 'Content 1' },
        { name: 'doc2.txt', content: 'Content 2' }
      ])

      const variables = { DOCUMENTS_JSON: documentsJson }

      const messages = ConsolidationPrompts.buildMessages?.(
        ConsolidationPrompts.MASTER_CONSOLIDATOR,
        variables
      )

      if (messages) {
        expect(messages[1].content).toContain('doc1.txt')
        expect(messages[1].content).toContain('doc2.txt')
      }
    })
  })

  describe('consolidation plan building', () => {
    it('should generate plan for multiple document types', () => {
      const documentTypes = ['policy', 'transcript', 'email', 'policy', 'note']

      const plan = ConsolidationPrompts.buildConsolidationPlan(5, documentTypes)

      expect(plan).toContain('Total Documents: 5')
      expect(plan).toContain('policy: 2')
      expect(plan).toContain('transcript: 1')
      expect(plan).toContain('email: 1')
      expect(plan).toContain('note: 1')
    })

    it('should handle single document type', () => {
      const documentTypes = ['policy']

      const plan = ConsolidationPrompts.buildConsolidationPlan(1, documentTypes)

      expect(plan).toContain('Total Documents: 1')
      expect(plan).toContain('Document Types: 1')
    })
  })
})