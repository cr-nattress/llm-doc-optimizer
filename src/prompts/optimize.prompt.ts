import type { PromptTemplate } from '../types/index.js'

export class PromptTemplates {
  static readonly CLARITY_OPTIMIZER: PromptTemplate = {
    system: `You are an expert business analyst and editor specializing in document clarity and information distillation. Your role is to analyze documents and extract the most critical information while maintaining accuracy and professional tone.`,
    user: `Analyze the following document and optimize it for clarity.

Instructions:
1. Identify and preserve all key information
2. Restructure content for logical flow
3. Simplify complex language while maintaining technical accuracy
4. Remove redundancies without losing important details
5. Create clear headings and subheadings
6. Add bullet points where appropriate for readability
7. Maintain formal, professional tone throughout

Document Type: {{DOCUMENT_TYPE}}
Document Name: {{DOCUMENT_NAME}}

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""

Provide the clarity-optimized version of this document.`,
    variables: ['DOCUMENT_TYPE', 'DOCUMENT_NAME', 'DOCUMENT_CONTENT']
  }

  static readonly STYLE_OPTIMIZER: PromptTemplate = {
    system: `You are a skilled technical writer and communication specialist. Your expertise lies in adapting complex documents for different audiences while preserving all essential information.`,
    user: `Transform the following document to improve its style and readability.

Instructions:
1. Rewrite for consistent tone and voice
2. Ensure professional language throughout
3. Standardize formatting and structure
4. Use active voice where possible
5. Improve sentence flow and transitions
6. Maintain all factual content exactly
7. Apply consistent terminology

Target Audience: {{TARGET_AUDIENCE}}
Document Name: {{DOCUMENT_NAME}}

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""

Provide the style-optimized version of this document.`,
    variables: ['TARGET_AUDIENCE', 'DOCUMENT_NAME', 'DOCUMENT_CONTENT']
  }

  static readonly CONSOLIDATOR: PromptTemplate = {
    system: `You are a document consolidation specialist with expertise in merging multiple documents while preserving all information and maintaining traceability to source materials.`,
    user: `Consolidate the following documents into a single, comprehensive master document.

Consolidation Rules:
1. Preserve all content from each source document
2. Group related information by topic/theme
3. Eliminate redundancies while noting where information was duplicated
4. Maintain clear source attribution for each section
5. Create a unified structure with consistent formatting
6. Add cross-references between related sections
7. Include a comprehensive table of contents
8. Preserve all stable IDs and references

Documents to Consolidate:
{{DOCUMENTS_JSON}}

Metadata Requirements:
- Mark each section with its source document
- Note consolidation decisions (merged sections, eliminated duplicates)
- Maintain document type classifications
- Preserve all timestamps and dates

Provide the consolidated master document.`,
    variables: ['DOCUMENTS_JSON']
  }

  static readonly LLM_OPTIMIZER: PromptTemplate = {
    system: `You are an AI assistant specializing in optimizing documents for LLM consumption. Your role is to preserve truth, normalize structure, and make content easily consumable by language models.`,
    user: `Optimize the following document for LLM processing.

## Optimization Rules:

### 1. Preserve Truth & Wording
- For transcripts: keep exact wording (no paraphrasing)
- For docs/emails/notes: normalize structure only, never alter meaning
- Do not remove, rewrite, or distort any original text

### 2. Optimize for LLM Use
- Output in Markdown format
- Add clear headings with stable chunk IDs (e.g., sec-1, sec-3-4-PTO, t=00:01:23)
- Include comprehensive metadata

### 3. Add Structure
- Create logical sections and subsections
- Add entity markers for people, organizations, locations
- Include topic tags for major themes
- Note temporal references and dates

### 4. Generate Indexes
- Entity index: maps entities to mentions & sections
- Topic index: maps topics/themes to sections
- Timeline: chronological sequence of events

Document Type: {{DOCUMENT_TYPE}}
Document Name: {{DOCUMENT_NAME}}

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""

Provide the LLM-optimized version with all required structure and metadata.`,
    variables: ['DOCUMENT_TYPE', 'DOCUMENT_NAME', 'DOCUMENT_CONTENT']
  }

  static readonly ENTITY_EXTRACTOR: PromptTemplate = {
    system: `You are an expert in named entity recognition and information extraction. Your task is to identify and categorize all entities mentioned in documents.`,
    user: `Extract all entities from the following document.

Entity Categories to Identify:
1. People (names, titles, roles)
2. Organizations (companies, departments, agencies)
3. Locations (cities, addresses, facilities)
4. Dates and Times (specific dates, time periods, deadlines)
5. Products/Services (product names, service offerings)
6. Financial Values (amounts, budgets, costs)
7. Technical Terms (systems, technologies, processes)
8. Policies/Regulations (policy names, legal references)

For each entity, provide:
- Entity name
- Category
- Context (surrounding text)
- Frequency (number of mentions)
- Related entities

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""

Return the extracted entities in a structured format.`,
    variables: ['DOCUMENT_CONTENT']
  }

  static readonly SUMMARIZER: PromptTemplate = {
    system: `You are an expert summarization specialist capable of distilling complex documents to their essential elements while maintaining accuracy.`,
    user: `Create a comprehensive summary of the following document.

Summary Requirements:
1. Executive summary (2-3 sentences)
2. Key points (5-7 bullet points)
3. Main conclusions or decisions
4. Action items or recommendations
5. Important dates or deadlines
6. Key stakeholders mentioned

Maintain the original document's:
- Technical accuracy
- Important numerical data
- Critical relationships
- Temporal sequences

Document Name: {{DOCUMENT_NAME}}

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""

Provide a structured summary following the requirements above.`,
    variables: ['DOCUMENT_NAME', 'DOCUMENT_CONTENT']
  }

  static interpolate(template: string, variables: Record<string, string>): string {
    let result = template

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      result = result.replace(regex, value)
    }

    return result
  }

  static validateVariables(
    template: PromptTemplate,
    variables: Record<string, string>
  ): boolean {
    return template.variables.every((variable) => variable in variables)
  }

  static buildMessages(
    template: PromptTemplate,
    variables: Record<string, string>
  ): Array<{ role: 'system' | 'user'; content: string }> {
    if (!this.validateVariables(template, variables)) {
      throw new Error(
        `Missing required variables. Required: ${template.variables.join(', ')}`
      )
    }

    return [
      { role: 'system', content: template.system },
      { role: 'user', content: this.interpolate(template.user, variables) }
    ]
  }

  static sanitizeInput(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  }
}