// ═══════════════════════════════════════
// ESD v2 — Type Definitions (Ranking Only)
// ═══════════════════════════════════════

export type Lang = 'en' | 'fr'

export type AppStep =
  | 'landing'
  | 'intro'
  | 'question'
  | 'processing'
  | 'dashboard'
  | 'report'

export type Band = 'critical' | 'red' | 'amber' | 'yellow' | 'green'

export type DesignAdoptionTag = 'Design' | 'Adoption' | 'Both' | '\u2014'

export type TraitId =
  | 'TRT_CA' | 'TRT_SA' | 'TRT_CI' | 'TRT_ED' | 'TRT_AC'
  | 'TRT_II' | 'TRT_DC' | 'TRT_LI' | 'TRT_CO' | 'TRT_CF'

export type DimensionId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8'

export type SystemType = 'Structural' | 'Social'

export interface Statement {
  id: string
  questionId: string
  text: { en: string; fr: string }
  polarity: 1 | -1
  tag: DesignAdoptionTag
  traitAllocations: Record<TraitId, number>
}

export interface Question {
  id: string
  dimensionId: DimensionId
  text: { en: string; fr: string }
  contextPrompt: { en: string; fr: string }
  statements: Statement[]
}

export interface Dimension {
  id: DimensionId
  name: { en: string; fr: string }
  system: SystemType
  weight: number
  hasDesignAdoption: boolean
  description: { en: string; fr: string }
}

export interface Trait {
  id: TraitId
  name: { en: string; fr: string }
  description: { en: string; fr: string }
  interventionCriticalRed: { en: string; fr: string }
  interventionAmber: { en: string; fr: string }
}

export interface SignalParagraph {
  statementId: string
  text: { en: string; fr: string }
}

export interface BandInterpretation {
  id: string
  band: Band
  text: { en: string; fr: string }
  actions?: { en: string; fr: string }
}

export interface Pattern {
  id: string
  name: { en: string; fr: string }
  interpretation: { en: string; fr: string }
  dimensions: DimensionId[]
  traits: TraitId[]
}

export interface FailureMode {
  id: string
  name: { en: string; fr: string }
  severity: 'High' | 'Medium-High' | 'Medium'
  description: { en: string; fr: string }
  recommendations: { en: string; fr: string }
}

export interface OrbBand {
  id: string
  band: Band
  label: { en: string; fr: string }
  interpretation: { en: string; fr: string }
  actions: { en: string; fr: string }
}

// ── User response (ranking only) ──

export interface StatementResponse {
  statementId: string
  rankPosition: number // 0=most like, 4=least like
}

export interface QuestionResponse {
  questionId: string
  statementResponses: StatementResponse[]
  contextExample: string
}

// ── Computed scores ──

export interface QuestionScore {
  questionId: string
  score: number
  band: Band
  topStatements: string[]
}

export interface DimensionScore {
  dimensionId: DimensionId
  score: number
  band: Band
  variance: number
  varianceFlag: 'Consistent' | 'High Variance'
  designScore?: number
  adoptionScore?: number
  questionScores: QuestionScore[]
}

export interface TraitScore {
  traitId: TraitId
  score: number
  band: Band
}

export interface PatternResult {
  patternId: string
  fired: boolean
  triggerDetails: string
}

export interface FailureModeResult {
  failureModeId: string
  fired: boolean
  triggerDetails: string
}

export interface DiagnosticResults {
  overallScore: number
  overallBand: Band
  dimensionScores: DimensionScore[]
  traitScores: TraitScore[]
  cascadeGap: number | null
  firedPatterns: PatternResult[]
  firedFailureModes: FailureModeResult[]
  responses: QuestionResponse[]
}
