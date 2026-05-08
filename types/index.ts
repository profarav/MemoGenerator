export type MeetingType =
  | 'prospect_intro'
  | 'client_meeting'
  | 'partner_meeting'
  | 'internal_strategy'
  | 'other'

export type MemoDepth = 'bare' | 'standard' | 'detailed'

export type MemoStatus = 'draft' | 'approved' | 'needs_review'

export type ReviewStatus = 'draft' | 'approved' | 'needs_review'

export type CertaintyLevel = 'confirmed' | 'likely' | 'unclear'

export interface Attendee {
  name: string
  title?: string
  email?: string
  raw: string
}

export interface MemoRequest {
  id: string
  meeting_title: string
  meeting_datetime: string | null
  company_name: string
  company_website: string | null
  meeting_type: MeetingType | null
  attendees: Attendee[] | null
  known_context: string | null
  internal_context: string | null
  memo_depth: MemoDepth
  status: MemoStatus
  created_at: string
  updated_at: string
}

export interface ResearchSource {
  id: string
  memo_request_id: string
  source_type: string
  title: string
  url: string
  snippet: string
  summary: string | null
  relevance_score: number | null
  created_at: string
}

export interface GeneratedMemo {
  id: string
  memo_request_id: string
  memo_markdown: string
  confidence_level: string | null
  review_status: ReviewStatus
  patrick_feedback: string | null
  created_at: string
  updated_at: string
}

// --- Research summary (raw extraction from sources) ---

export interface PreviousCompany {
  name: string
  whatItDid: string
  whoItServed: string
  currentStatus: string
  certaintyLevel: CertaintyLevel
}

export interface PersonBackground {
  name: string
  currentRole?: string
  facts: string[]
  previousCompanies?: PreviousCompany[]
  otherRoles?: string[]
}

export interface ResearchSummary {
  companyBackground: string[]
  peopleBackground: PersonBackground[]
  notableSignals: string[]
  relevantFacts: string[]
  openQuestions: string[]
  sourceNotes: string[]
}

// --- Relevance map (signal prioritization layer) ---

export interface ExplainedPriorProduct {
  name: string
  whatItDid: string
  whoItServed: string
  currentStatus: string
  whyItMatters: string
  certaintyLevel: CertaintyLevel
}

export interface ProductRelevanceScore {
  productName: string
  categoryClarity: 'clear' | 'partial' | 'unclear'
  statusClarity: 'active' | 'inactive' | 'unclear'
  problemSpace: string
  internalRelevance: 'high' | 'medium' | 'low'
  internalRelevanceReason: string
  conversationHookValue: 'high' | 'medium' | 'low'
  overallScore: 'high' | 'medium' | 'low'
  priorityReason: string
}

export interface RelevanceBuckets {
  directOverlap: string[]
  similarCustomerBase: string[]
  similarWorkflowOrProblem: string[]
  aiAutomationRelevance: string[]
  founderProductExperience: string[]
  salesAgencyRelevance: string[]
  recentGrowthSignals: string[]
  personalConversationHooks: string[]
}

export interface RelevanceMap {
  highestSignalFacts: string[]
  productRelevanceScores?: ProductRelevanceScore[]
  relevanceBuckets: RelevanceBuckets
  priorProductsExplained: ExplainedPriorProduct[]
  whyPersonMatters: string
  conversationHooks: string[]
  uncertainItems: string[]
}
