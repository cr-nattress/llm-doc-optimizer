import type { PromptTemplate } from '../types/index.js'

export class ConsolidationPrompts {
  static readonly MASTER_CONSOLIDATOR: PromptTemplate = {
    system: `You are an AI assistant specializing in document consolidation. Your role is to merge multiple LLM-optimized documents into a single, comprehensive master reference while preserving all information and structure.`,
    user: `Consolidate the following LLM-optimized documents into a single master document.

## Consolidation Rules:

### 1. Preserve Truth & Structure
- Keep all original optimized text exactly as it appears
- Do not paraphrase, rewrite, or drop content
- Maintain all stable IDs (e.g., sec-3-4-PTO, t=00:05:30)

### 2. Merge Like Documents
- Group related docs together (policies, transcripts, notes, etc.)
- Preserve section order and IDs for valid index references
- Add source citation markers at each section start

### 3. Normalize Metadata
Each merged section must begin with:
- Source file(s)
- Document type
- Date(s)
- Entities mentioned
- Token size

### 4. Consolidated Index
Generate a comprehensive table of contents:
- Organized by document type
- Links to stable section IDs
- Cross-references between related content

Documents to Consolidate:
"""
{{DOCUMENTS_JSON}}
"""

Provide the consolidated master document with all requirements met.`,
    variables: ['DOCUMENTS_JSON']
  }

  static readonly INDEX_BUILDER: PromptTemplate = {
    system: `You are an indexing specialist who creates comprehensive, cross-referenced indexes for consolidated documents.`,
    user: `Build comprehensive indexes for the following consolidated document.

Create these indexes:

1. **Entity Index** (/index/entity_index.md)
   - All people, organizations, locations, systems
   - Section references for each mention
   - Relationship mappings

2. **Topic Index** (/index/topic_index.md)
   - Major themes and subjects
   - Section mappings
   - Related topic clusters

3. **Timeline Index** (/index/timeline.md)
   - Chronological event sequence
   - Policy effective dates
   - Project milestones
   - Meeting dates

4. **Cross-Reference Matrix**
   - Document-to-document relationships
   - Shared entities across documents
   - Topic overlaps

Consolidated Document:
"""
{{CONSOLIDATED_DOCUMENT}}
"""

Generate all four indexes with stable ID references.`,
    variables: ['CONSOLIDATED_DOCUMENT']
  }

  static readonly METADATA_GENERATOR: PromptTemplate = {
    system: `You are a metadata specialist who generates comprehensive metadata for document collections.`,
    user: `Generate project-wide metadata for the following document collection.

Required Metadata:

1. **Project Digest** (README_ProjectDigest.md)
   - Project overview
   - Document inventory
   - Key themes across all documents
   - Statistical summary

2. **Document Metadata**
   For each document:
   - File name and type
   - Authors/participants
   - Creation/modification dates
   - Word count and token size
   - Key entities (top 10)
   - Main topics (top 5)
   - Document purpose/context

3. **Collection Statistics**
   - Total documents
   - Total word count
   - Total unique entities
   - Topic distribution
   - Document type breakdown

Document Collection:
"""
{{DOCUMENT_COLLECTION}}
"""

Generate comprehensive metadata following the structure above.`,
    variables: ['DOCUMENT_COLLECTION']
  }

  static readonly DEDUPLICATION_OPTIMIZER: PromptTemplate = {
    system: `You are a deduplication specialist who identifies and consolidates redundant information across documents.`,
    user: `Identify and consolidate redundant information across these documents.

Deduplication Process:

1. **Identify Duplicates**
   - Exact text matches
   - Semantic duplicates (same meaning, different wording)
   - Partial overlaps

2. **Consolidation Strategy**
   - Keep the most complete version
   - Note all source locations
   - Create single source of truth
   - Add cross-references to original locations

3. **Tracking**
   - Document what was consolidated
   - Note conflict resolutions
   - Maintain audit trail

Documents to Analyze:
"""
{{DOCUMENTS}}
"""

Provide:
1. Deduplicated content
2. Consolidation report
3. Cross-reference mapping`,
    variables: ['DOCUMENTS']
  }

  static buildConsolidationPlan(
    documentCount: number,
    documentTypes: string[]
  ): string {
    const typeGroups = documentTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    let plan = '# Document Consolidation Plan\n\n'
    plan += `## Overview\n`
    plan += `- Total Documents: ${documentCount}\n`
    plan += `- Document Types: ${Object.keys(typeGroups).length}\n\n`

    plan += '## Grouping Strategy\n'
    for (const [type, count] of Object.entries(typeGroups)) {
      plan += `- ${type}: ${count} document(s)\n`
    }

    plan += '\n## Processing Order\n'
    plan += '1. Group documents by type\n'
    plan += '2. Process each group sequentially\n'
    plan += '3. Build cross-group references\n'
    plan += '4. Generate consolidated indexes\n'
    plan += '5. Create master table of contents\n'

    return plan
  }
}