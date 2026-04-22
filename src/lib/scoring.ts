// ═══════════════════════════════════════
// ESD v2 — Scoring Engine (Ranking Only)
// rank_score = (4 - rankPosition) / 4
// ═══════════════════════════════════════

import type {
  Band, TraitId, DimensionId, Statement, Question, Dimension,
  StatementResponse, QuestionResponse, QuestionScore, DimensionScore,
  TraitScore, PatternResult, FailureModeResult, DiagnosticResults
} from './types'

const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  D1: 0.15, D2: 0.10, D3: 0.15, D4: 0.12,
  D5: 0.10, D6: 0.18, D7: 0.10, D8: 0.10,
}

const QUESTION_TO_DIMENSION: Record<string, DimensionId> = {
  Q01: 'D1', Q02: 'D1', Q03: 'D2', Q04: 'D2',
  Q05: 'D3', Q06: 'D3', Q07: 'D4', Q08: 'D4',
  Q09: 'D5', Q10: 'D5',
  Q11a: 'D6', Q11b: 'D6', Q12: 'D6', Q13: 'D6', Q14: 'D6',
  Q15: 'D7', Q16: 'D7', Q17: 'D8', Q18: 'D8',
}

const ALL_TRAIT_IDS: TraitId[] = [
  'TRT_CA', 'TRT_SA', 'TRT_CI', 'TRT_ED', 'TRT_AC',
  'TRT_II', 'TRT_DC', 'TRT_LI', 'TRT_CO', 'TRT_CF',
]

export function getBand(score: number): Band {
  if (score <= 20) return 'critical'
  if (score <= 40) return 'red'
  if (score <= 60) return 'amber'
  if (score <= 80) return 'yellow'
  return 'green'
}

export function getBandLabel(band: Band, lang: 'en' | 'fr'): string {
  const labels: Record<Band, { en: string; fr: string }> = {
    critical: { en: 'Critical', fr: 'Critique' },
    red: { en: 'Red', fr: 'Rouge' },
    amber: { en: 'Amber', fr: 'Orange' },
    yellow: { en: 'Yellow', fr: 'Jaune' },
    green: { en: 'Green', fr: 'Vert' },
  }
  return labels[band][lang]
}

export function getBandColor(band: Band): string {
  const colors: Record<Band, string> = {
    critical: '#7F1D1D',
    red: '#C14B6C',
    amber: '#F79F20',
    yellow: '#EAB308',
    green: '#0DCBC4',
  }
  return colors[band]
}

// ── Rank score: (4 - rankPosition) / 4 ──
// rankPosition 0 (most like) → 1.0
// rankPosition 4 (least like) → 0.0
function rankScore(rankPosition: number): number {
  return (4 - rankPosition) / 4
}

// ── Question score ──
export function computeQuestionScore(
  question: Question,
  response: QuestionResponse
): QuestionScore {
  const respMap = new Map(response.statementResponses.map(r => [r.statementId, r]))

  // Raw score = sum(rankScore * polarity * 10)
  let rawScore = 0
  let theoreticalMax = 0
  let theoreticalMin = 0

  const scored: { id: string; rs: number }[] = []

  for (const stmt of question.statements) {
    const resp = respMap.get(stmt.id)
    if (!resp) continue
    const rs = rankScore(resp.rankPosition)
    rawScore += rs * stmt.polarity * 10
    scored.push({ id: stmt.id, rs })

    if (stmt.polarity === 1) {
      theoreticalMax += 1.0 * 10   // best case: rank 1
      theoreticalMin += 0.0 * 10   // worst case: rank 5
    } else {
      theoreticalMax += 0.0 * (-10) // best case: rank 5 (no negative contribution)
      theoreticalMin += 1.0 * (-10) // worst case: rank 1 (full negative)
    }
  }

  const range = theoreticalMax - theoreticalMin
  const score = range === 0 ? 50 : Math.max(0, Math.min(100,
    100 * (rawScore - theoreticalMin) / range
  ))

  // Top-2 statements by rank score (highest first)
  const sorted = [...scored].sort((a, b) => b.rs - a.rs)
  const topStatements = sorted.slice(0, 2).map(s => s.id)

  return {
    questionId: question.id,
    score: Math.round(score * 10) / 10,
    band: getBand(score),
    topStatements,
  }
}

// ── Design/Adoption sub-scores (D1-D5) ──
function computeSubScore(
  question: Question,
  response: QuestionResponse,
  tagFilter: ('Design' | 'Both')[] | ('Adoption' | 'Both')[]
): number {
  const respMap = new Map(response.statementResponses.map(r => [r.statementId, r]))
  const filtered = question.statements.filter(s =>
    (tagFilter as string[]).includes(s.tag)
  )
  if (filtered.length === 0) return -1

  let raw = 0, tMax = 0, tMin = 0
  for (const stmt of filtered) {
    const resp = respMap.get(stmt.id)
    if (!resp) continue
    const rs = rankScore(resp.rankPosition)
    raw += rs * stmt.polarity * 10
    if (stmt.polarity === 1) { tMax += 10; tMin += 0 }
    else { tMax += 0; tMin += -10 }
  }

  const range = tMax - tMin
  if (range === 0) continue 50
  return Math.max(0, Math.min(100,
    Math.round(100 * (raw - tMin) / range * 10) / 10
  ))
}

// ── Dimension score ──
export function computeDimensionScore(
  dimensionId: DimensionId,
  questions: Question[],
  responses: QuestionResponse[],
  hasDesignAdoption: boolean
): DimensionScore {
  const dimQuestions = questions.filter(q =>
    q.id in QUESTION_TO_DIMENSION && QUESTION_TO_DIMENSION[q.id] === dimensionId
  )
  const questionScores: QuestionScore[] = []
  const designScores: number[] = []
  const adoptionScores: number[] = []

  for (const q of dimQuestions) {
    const resp = responses.find(r => r.questionId === q.id)
    if (!resp) continue
    questionScores.push(computeQuestionScore(q, resp))

    if (hasDesignAdoption) {
      const ds = computeSubScore(q, resp, ['Design', 'Both'])
      const as2 = computeSubScore(q, resp, ['Adoption', 'Both'])
      if (ds >= 0) designScores.push(ds)
      if (as2 >= 0) adoptionScores.push(as2)
    }
  }

  const scores = questionScores.map(qs => qs.score)
  const avg = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : 0
  const variance = scores.length > 1
    ? Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10 : 0

  return {
    dimensionId, score: avg, band: getBand(avg), variance,
    varianceFlag: variance > 25 ? 'High Variance' : 'Consistent',
    designScore: designScores.length > 0
      ? Math.round(designScores.reduce((a, b) => a + b, 0) / designScores.length * 10) / 10 : undefined,
    adoptionScore: adoptionScores.length > 0
      ? Math.round(adoptionScores.reduce((a, b) => a + b, 0) / adoptionScores.length * 10) / 10 : undefined,
    questionScores,
  }
}

// ── Trait scores ──
export function computeTraitScores(
  questions: Question[], responses: QuestionResponse[]
): TraitScore[] {
  return ALL_TRAIT_IDS.map(traitId => {
    const contributions: number[] = []
    for (const q of questions) {
      const hasContrib = q.statements.some(s => s.traitAllocations[traitId] > 0)
      if (!hasContrib) continue
      const resp = responses.find(r => r.questionId === q.id)
      if (!resp) continue
      const respMap = new Map(resp.statementResponses.map(r => [r.statementId, r]))

      let raw = 0, tMax = 0, tMin = 0
      for (const stmt of q.statements) {
        const alloc = stmt.traitAllocations[traitId]
        if (alloc === 0) continue
        const sr = respMap.get(stmt.id)
        if (!sr) continue
        const rs = rankScore(sr.rankPosition)
        raw += alloc * rs * stmt.polarity
        if (stmt.polarity === 1) { tMax += alloc * 1.0; tMin += alloc * 0.0 }
        else { tMax += alloc * 0.0; tMin += alloc * (-1.0) }
      }
      const range = tMax - tMin
      if (range === 0) continue
      contributions.push(Math.max(0, Math.min(100, 100 * (raw - tMin) / range)))
    }
    const avg = contributions.length > 0
      ? Math.round(contributions.reduce((a, b) => a + b, 0) / contributions.length * 10) / 10 : 50
    return { traitId, score: avg, band: getBand(avg) }
  })
}

// ── Pattern detection ──
export function checkPatterns(
  dimensionScores: DimensionScore[],
  questionScoreMap: Map<string, number>
): PatternResult[] {
  const d = (id: DimensionId) => dimensionScores.find(ds => ds.dimensionId === id)?.score ?? 0
  const q = (id: string) => questionScoreMap.get(id) ?? 0

  return [
    { id: 'PAT_BC', condition: d('D1') <= 40 && d('D5') <= 40, details: `D1=${d('D1').toFixed(1)}, D5=${d('D5').toFixed(1)}` },
    { id: 'PAT_AI', condition: q('Q11a') >= 61 && d('D3') <= 40, details: `Q11a=${q('Q11a').toFixed(1)}, D3=${d('D3').toFixed(1)}` },
    { id: 'PAT_CF', condition: q('Q11a') >= 61 && q('Q11b') <= 40, details: `Q11a=${q('Q11a').toFixed(1)}, Q11b=${q('Q11b').toFixed(1)}` },
    { id: 'PAT_CV', condition: d('D7') <= 40 && d('D8') <= 40, details: `D7=${d('D7').toFixed(1)}, D8=${d('D8').toFixed(1)}` },
    { id: 'PAT_GR', condition: d('D4') <= 40 && d('D3') <= 40, details: `D4=${d('D4').toFixed(1)}, D3=${d('D3').toFixed(1)}` },
    { id: 'PAT_PS', condition: d('D4') <= 60 && d('D5') <= 40, details: `D4=${d('D4').toFixed(1)}, D5=${d('D5').toFixed(1)}` },
    { id: 'PAT_SS', condition: d('D2') >= 61 && d('D7') <= 40, details: `D2=${d('D2').toFixed(1)}, D7=${d('D7').toFixed(1)}` },
    { id: 'PAT_CG', condition: q('Q13') <= 40 && q('Q17') <= 40, details: `Q13=${q('Q13').toFixed(1)}, Q17=${q('Q17').toFixed(1)}` },
    { id: 'PAT_CU', condition: q('Q14') >= 61 && q('Q12') <= 40, details: `Q14=${q('Q14').toFixed(1)}, Q12=${q('Q12').toFixed(1)}` },
    { id: 'PAT_ID', condition: d('D5') <= 40 && d('D3') <= 40 && d('D7') <= 60, details: `D5=${d('D5').toFixed(1)}, D3=${d('D3').toFixed(1)}, D7=${d('D7').toFixed(1)}` },
    { id: 'PAT_FR', condition: q('Q17') <= 40 && d('D7') <= 60 && q('Q13') <= 60, details: `Q17=${q('Q17').toFixed(1)}, D7=${d('D7').toFixed(1)}, Q13=${q('Q13').toFixed(1)}` },
    { id: 'PAT_IS', condition: q('Q18') <= 40 && q('Q11a') >= 41, details: `Q18=${q('Q18').toFixed(1)}, Q11a=${q('Q11a').toFixed(1)}` },
    { id: 'PAT_SD', condition: d('D2') <= 40 && d('D4') >= 61, details: `D2=${d('D2').toFixed(1)}, D4=${d('D4').toFixed(1)}` },
    { id: 'PAT_LD', condition: q('Q11a') <= 40 && q('Q15') >= 61, details: `Q11a=${q('Q11a').toFixed(1)}, Q15=${q('Q15').toFixed(1)}` },
  ].map(p => ({ patternId: p.id, fired: p.condition, triggerDetails: p.details }))
}

// ── Failure mode detection ──
// "In top 2" = rankPosition <= 1 (ranked 1st or 2nd)
export function checkFailureModes(
  dimensionScores: DimensionScore[],
  questionScoreMap: Map<string, number>,
  rankMap: Map<string, number>, // statementId → rankPosition (0-indexed)
  firedPatternIds: Set<string>
): FailureModeResult[] {
  const d = (id: DimensionId) => dimensionScores.find(ds => ds.dimensionId === id)?.score ?? 0
  const q = (id: string) => questionScoreMap.get(id) ?? 0
  const top2 = (id: string) => (rankMap.get(id) ?? 99) <= 1

  return [
    { id: 'FM_EP', condition: d('D1') <= 40 && d('D3') <= 40 && (top2('S02A') || top2('S02B')),
      details: `D1=${d('D1').toFixed(1)}, D3=${d('D3').toFixed(1)}, S02A rank=${rankMap.get('S02A')??'?'}, S02B rank=${rankMap.get('S02B')??'?'}` },
    { id: 'FM_SF', condition: d('D4') <= 40 && d('D5') <= 40 && (top2('S07C') || top2('S08E')),
      details: `D4=${d('D4').toFixed(1)}, D5=${d('D5').toFixed(1)}` },
    { id: 'FM_FM', condition: q('Q17') <= 40 && d('D7') <= 40 && (top2('S17A') || top2('S17E')),
      details: `Q17=${q('Q17').toFixed(1)}, D7=${d('D7').toFixed(1)}` },
    { id: 'FM_LT', condition: q('Q11a') >= 61 && q('Q12') <= 40 && firedPatternIds.has('PAT_AI'),
      details: `Q11a=${q('Q11a').toFixed(1)}, Q12=${q('Q12').toFixed(1)}, PAT_AI=fired` },
    { id: 'FM_IDR', condition: d('D5') <= 40 && d('D3') <= 40 && top2('S10B'),
      details: `D5=${d('D5').toFixed(1)}, D3=${d('D3').toFixed(1)}` },
    { id: 'FM_IS', condition: q('Q18') <= 40 && (top2('S18A') || top2('S18E')),
      details: `Q18=${q('Q18').toFixed(1)}` },
    { id: 'FM_CB', condition: q('Q14') <= 40 && q('Q12') <= 60 && (top2('S14A') || top2('S14D')),
      details: `Q14=${q('Q14').toFixed(1)}, Q12=${q('Q12').toFixed(1)}` },
    { id: 'FM_CC', condition: d('D3') <= 40 && d('D2') <= 60 && d('D4') <= 60 && (top2('S05A') || top2('S06A')),
      details: `D3=${d('D3').toFixed(1)}, D2=${d('D2').toFixed(1)}, D4=${d('D4').toFixed(1)}` },
    { id: 'FM_SO', condition: q('Q16') <= 40 && q('Q10') <= 40 && (top2('S16A') || top2('S10E')),
      details: `Q16=${q('Q16').toFixed(1)}, Q10=${q('Q10').toFixed(1)}` },
  ].map(f => ({ failureModeId: f.id, fired: f.condition, triggerDetails: f.details }))
}

// ── Overall ──
export function computeOverallScore(dimensionScores: DimensionScore[]): number {
  let w = 0
  for (const ds of dimensionScores) w += ds.score * (DIMENSION_WEIGHTS[ds.dimensionId] ?? 0)
  return Math.round(w * 10) / 10
}

export function computeCascadeGap(qMap: Map<string, number>): number | null {
  const a = qMap.get('Q11a'), b = qMap.get('Q11b')
  if (a === undefined || b === undefined) return null
  return Math.round((a - b) * 10) / 10
}

// ── Master computation ──
export function computeAllScores(
  questions: Question[], dimensions: Dimension[], responses: QuestionResponse[]
): DiagnosticResults {
  const questionScoreMap = new Map<string, number>()
  for (const q of questions) {
    const resp = responses.find(r => r.questionId === q.id)
    if (!resp) continue
    questionScoreMap.set(q.id, computeQuestionScore(q, resp).score)
  }

  // Rank map for FM triggers
  const rankMap = new Map<string, number>()
  for (const resp of responses) {
    for (const sr of resp.statementResponses) {
      rankMap.set(sr.statementId, sr.rankPosition)
    }
  }

  const dimensionScores = dimensions.map(dim =>
    computeDimensionScore(dim.id, questions, responses, dim.hasDesignAdoption)
  )

  const overallScore = computeOverallScore(dimensionScores)
  const traitScores = computeTraitScores(questions, responses)
  const cascadeGap = computeCascadeGap(questionScoreMap)

  const patternResults = checkPatterns(dimensionScores, questionScoreMap)
  const firedPatternIds = new Set(patternResults.filter(p => p.fired).map(p => p.patternId))
  const failureModeResults = checkFailureModes(dimensionScores, questionScoreMap, rankMap, firedPatternIds)

  return {
    overallScore, overallBand: getBand(overallScore),
    dimensionScores, traitScores, cascadeGap,
    firedPatterns: patternResults.filter(p => p.fired),
    firedFailureModes: failureModeResults.filter(f => f.fired),
    responses,
  }
}
