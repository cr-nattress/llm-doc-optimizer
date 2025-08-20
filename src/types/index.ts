export interface OptimizationRequest {
  documents: DocumentInput[]
  mode: 'text' | 'json' | 'all'
  optimizationType: 'clarity' | 'style' | 'consolidate'
  model?: 'gpt-4' | 'gpt-3.5-turbo' | 'gpt-4-turbo'
  temperature?: number
  maxTokens?: number
}

export interface DocumentInput {
  name: string
  content: string
  type?: 'transcript' | 'policy' | 'email' | 'note'
  metadata?: Record<string, unknown>
}

export interface OptimizationResult {
  originalFilename: string
  optimizedContent: string
  indexes?: DocumentIndexes
  metadata: DocumentMetadata
  status: 'fulfilled' | 'rejected'
  error?: string
}

export interface DocumentIndexes {
  entities: EntityIndex[]
  topics: TopicIndex[]
  timeline: TimelineEntry[]
}

export interface EntityIndex {
  name: string
  type: 'person' | 'organization' | 'location' | 'date' | 'other'
  mentions: number
  context: string[]
}

export interface TopicIndex {
  topic: string
  relevance: number
  sections: string[]
}

export interface TimelineEntry {
  date: string
  event: string
  significance: 'high' | 'medium' | 'low'
}

export interface DocumentMetadata {
  originalLength: number
  optimizedLength: number
  compressionRatio: number
  processingTime: number
  model: string
  timestamp: string
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  cost?: number
}

export interface AuthenticatedRequest {
  userId: string
  apiKey: string
  timestamp: number
}

export interface ErrorResponse {
  error: string
  code: string
  details?: unknown
  timestamp: string
}

export interface OpenAIConfig {
  apiKey: string
  organization?: string
  baseURL?: string
  timeout?: number
  maxRetries?: number
}

export interface PromptTemplate {
  system: string
  user: string
  variables: string[]
}

export interface ProcessingOptions {
  enableStreaming: boolean
  enableRateLimiting: boolean
  maxFileSize: number
  maxFiles: number
  allowedFileTypes: string[]
}

export interface JWTPayload {
  userId: string
  email?: string
  exp: number
  iat: number
}

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  message: string
}