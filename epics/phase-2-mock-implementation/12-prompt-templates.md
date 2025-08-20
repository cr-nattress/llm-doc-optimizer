# User Story: Create Prompt Templates

## Story
As a prompt engineer, I want reusable prompt templates with variable substitution so that we can maintain consistent AI interactions across different document types.

## Acceptance Criteria
- [ ] Templates support variable interpolation
- [ ] Different templates for each optimization type
- [ ] Templates include role assignment and instructions
- [ ] Delimiters prevent prompt injection
- [ ] Templates are version controlled

## Technical Details
Create src/prompts/optimize.prompt.ts:
```typescript
export class PromptTemplates {
  static readonly CLARITY_OPTIMIZER = `
You are an expert business analyst and editor. Your task is to analyze the following document and distill its most critical information.

Instructions:
1. Summarize the document into exactly three key bullet points
2. Each bullet point must be a single, concise sentence
3. Focus exclusively on primary conclusions and actionable recommendations
4. Maintain a formal and professional tone
5. Respond only with the bulleted list

Document Type: {{DOCUMENT_TYPE}}
Document Name: {{DOCUMENT_NAME}}

Document Content:
"""
{{DOCUMENT_CONTENT}}
"""
`;

  static readonly STYLE_OPTIMIZER = `
You are a skilled science communicator and copywriter. Your goal is to rewrite the provided document for a non-technical audience.

Instructions:
1. Rewrite the entire document
2. Eliminate all technical jargon
3. Use analogies where helpful
4. Adopt a friendly, approachable tone
5. Structure for easy readability

Document:
"""
{{DOCUMENT_CONTENT}}
"""
`;

  static readonly CONSOLIDATOR = `
You are a document consolidation specialist. Merge the following optimized documents into a single master reference.

Rules:
1. Preserve all section IDs
2. Group by document type
3. Maintain original text exactly
4. Add source citations
5. Create unified table of contents

Documents to consolidate:
{{DOCUMENTS_JSON}}
`;

  static interpolate(
    template: string, 
    variables: Record<string, string>
  ): string {
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (match, key) => variables[key] || match
    );
  }
}
```

## Definition of Done
- [ ] All optimization types have templates
- [ ] Variable substitution works correctly
- [ ] Templates are secure against injection
- [ ] Templates produce consistent outputs