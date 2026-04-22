// ═══════════════════════════════════════
// ESD v2 — AI Prompt Builder (Ranking Only)
// ═══════════════════════════════════════

import type { Lang, DiagnosticResults } from './types'
import { DIMENSIONS, QUESTIONS, TRAITS } from './questions'
import {
  SIGNAL_PARAGRAPHS, Q_BAND_INTERPS, D_BAND_INTERPS,
  PATTERNS, FAILURE_MODES, ORB_BANDS
} from './interpretations'
import { getBandLabel } from './scoring'

function getQBand(qId: string, band: string, lang: Lang): string {
  return Q_BAND_INTERPS[qId]?.[band as keyof typeof Q_BAND_INTERPS[string]]?.[lang] ?? ''
}

function getDBand(dId: string, band: string, lang: Lang): { text: string; actions: string } {
  const entry = D_BAND_INTERPS[dId]?.[band as keyof typeof D_BAND_INTERPS[string]]
  return { text: entry?.text?.[lang] ?? '', actions: entry?.actions?.[lang] ?? '' }
}

export function buildReportPrompt(results: DiagnosticResults, lang: Lang): { system: string; user: string } {
  const l = lang

  const orbBlock = ORB_BANDS[results.overallBand]?.interpretation?.[l] ?? ''

  // Build dimension sections
  const dimSections: string[] = []
  for (const dim of DIMENSIONS) {
    const ds = results.dimensionScores.find(d => d.dimensionId === dim.id)
    if (!ds) continue
    const dBand = getDBand(dim.id, ds.band, l)
    let section = `## ${dim.name[l]} \u2014 ${ds.score}/100 (${getBandLabel(ds.band, l)})`
    if (dim.hasDesignAdoption && ds.designScore !== undefined && ds.adoptionScore !== undefined)
      section += ` | Design: ${ds.designScore} | Adoption: ${ds.adoptionScore}`
    if (ds.varianceFlag === 'High Variance') section += ` | \u26a0\ufe0f HIGH VARIANCE`
    section += `\n\n### Dimension Assessment\n${dBand.text}`
    if (dim.hasDesignAdoption && ds.designScore !== undefined && ds.adoptionScore !== undefined) {
      const gap = ds.designScore - ds.adoptionScore
      if (gap > 15) section += `\n\n### Design-Adoption Gap\nThis dimension scores ${ds.designScore} on design but only ${ds.adoptionScore} on adoption. Gap: ${gap.toFixed(0)} points.`
    }
    for (const qs of ds.questionScores) {
      const question = QUESTIONS.find(q => q.id === qs.questionId)
      if (!question) continue
      section += `\n\n#### ${qs.questionId} (${qs.score}/100, ${getBandLabel(qs.band, l)})\n**Question:** ${question.text[l]}\n\n**Assessment:** ${getQBand(qs.questionId, qs.band, l)}`
      for (let i = 0; i < qs.topStatements.length; i++) {
        const stmtId = qs.topStatements[i]
        const stmt = question.statements.find(s => s.id === stmtId)
        const signal = SIGNAL_PARAGRAPHS[stmtId]?.[l]
        if (stmt && signal) {
          const label = i === 0 ? 'Strongest signal' : 'Reinforcing signal'
          section += `\n\n**${label}:** _"${stmt.text[l]}"_\n${signal}`
        }
      }
      const resp = results.responses.find(r => r.questionId === qs.questionId)
      if (resp?.contextExample?.trim()) section += `\n\n**User context example:** "${resp.contextExample}"`
    }
    section += `\n\n### Priority Actions\n${dBand.actions}`
    dimSections.push(section)
  }

  const patternBlocks = results.firedPatterns.map(pr => {
    const pat = PATTERNS[pr.patternId]
    return pat ? `### ${pat.name[l]}\n**Triggered by:** ${pr.triggerDetails}\n\n${pat.interpretation[l]}` : ''
  }).filter(Boolean)

  const fmBlocks = results.firedFailureModes.map(fmr => {
    const fm = FAILURE_MODES[fmr.failureModeId]
    return fm ? `### ${fm.name[l]} \u2014 Severity: ${fm.severity}\n**Triggered by:** ${fmr.triggerDetails}\n\n**Description:** ${fm.description[l]}\n\n**Recommended actions:** ${fm.recommendations[l]}` : ''
  }).filter(Boolean)

  const traitBlocks = [...results.traitScores].sort((a, b) => a.score - b.score).map(ts => {
    const trait = TRAITS.find(t => t.id === ts.traitId)
    if (!trait) return ''
    const intervention = (ts.band === 'critical' || ts.band === 'red')
      ? trait.interventionCriticalRed[l]
      : ts.band === 'amber' ? trait.interventionAmber[l] : ''
    return intervention ? `**${trait.name[l]}** \u2014 ${ts.score}/100 (${getBandLabel(ts.band, l)}): ${intervention}` : ''
  }).filter(Boolean)

  const cascadeSection = results.cascadeGap !== null && results.cascadeGap > 30
    ? `The leadership cascade gap is ${results.cascadeGap} points (Q11a vs Q11b). This indicates a significant breakdown in how alignment translates from the senior team to the next leadership layer.` : ''

  const contextExamples = results.responses
    .filter(r => r.contextExample?.trim())
    .map(r => {
      const q = QUESTIONS.find(qu => qu.id === r.questionId)
      return `${r.questionId} (${q?.text[l]?.substring(0, 60)}...): "${r.contextExample}"`
    })

  const languageInstruction = lang === 'fr'
    ? 'Write the ENTIRE report in FRENCH.'
    : 'Write the ENTIRE report in ENGLISH.'

  const system = `You are the report engine for the Execution System Scan v2.0 by Mosaic Shifter.

${languageInstruction}

## YOUR ROLE
You assemble a coherent diagnostic report from pre-written interpretation blocks AND add three types of AI-generated content:
1. **Executive Summary** \u2014 Synthesise blocks into a coherent narrative story.
2. **Organisation-Specific Context** \u2014 After each dimension, connect user examples to findings. Introduce with: "Based on the examples provided:"
3. **What to Investigate** \u2014 3\u20135 follow-up questions after each pattern and failure mode.

## CRITICAL RULES
- NEVER modify pre-written blocks. Insert them EXACTLY as provided.
- AI-generated sections must be specific, actionable, and grounded in the data.
- Use markdown headers (##, ###, ####).
- Be direct and practical. No filler.`

  const user = `Generate the Execution System Scan Report.

## SCORES
**Overall:** ${results.overallScore}/100 (${getBandLabel(results.overallBand, l)})
**Dimensions:**
${results.dimensionScores.map(ds => {
    const dim = DIMENSIONS.find(d => d.id === ds.dimensionId)
    let line = `- ${dim?.name[l]} (${ds.dimensionId}): ${ds.score}/100 (${getBandLabel(ds.band, l)})`
    if (ds.designScore !== undefined) line += ` | Design: ${ds.designScore} | Adoption: ${ds.adoptionScore}`
    if (ds.varianceFlag === 'High Variance') line += ' | \u26a0\ufe0f HIGH VARIANCE'
    return line
  }).join('\n')}
${cascadeSection ? `\n**Cascade Gap:** ${cascadeSection}` : ''}
**Patterns (${results.firedPatterns.length}):** ${results.firedPatterns.length > 0 ? results.firedPatterns.map(p => PATTERNS[p.patternId]?.name[l]).join(', ') : 'None'}
**Failure Modes (${results.firedFailureModes.length}):** ${results.firedFailureModes.length > 0 ? results.firedFailureModes.map(f => FAILURE_MODES[f.failureModeId]?.name[l]).join(', ') : 'None'}

${contextExamples.length > 0 ? `## USER CONTEXT EXAMPLES\n${contextExamples.join('\n')}` : ''}

## REPORT SECTIONS:

### SECTION 1: EXECUTIVE SUMMARY
Overall: ${orbBlock}
${results.firedPatterns.length > 0 ? `Biggest tension: ${PATTERNS[results.firedPatterns[0].patternId]?.name[l]}` : ''}
${results.firedFailureModes.length > 0 ? `Biggest risk: ${FAILURE_MODES[results.firedFailureModes[0].failureModeId]?.name[l]}` : ''}
${cascadeSection || ''}

### SECTION 2: STRUCTURAL SYSTEM (D1\u2013D5)
${dimSections.filter((_, i) => DIMENSIONS[i]?.system === 'Structural').join('\n\n---\n\n')}

### SECTION 3: SOCIAL SYSTEM (D6\u2013D8)
${dimSections.filter((_, i) => DIMENSIONS[i]?.system === 'Social').join('\n\n---\n\n')}

### SECTION 4: SYSTEMIC PATTERNS
${patternBlocks.length > 0 ? patternBlocks.join('\n\n---\n\n') : 'No systemic patterns detected.'}

### SECTION 5: FAILURE MODES
${fmBlocks.length > 0 ? fmBlocks.join('\n\n---\n\n') : 'No failure modes triggered.'}

### SECTION 6: TRAIT ANALYSIS
${traitBlocks.join('\n')}

### SECTION 7: PRIORITY ACTIONS
Consolidate from dimensions, failure modes, and traits. Group: Immediate / First 30 days / First 60 days.

Now generate the complete report.`

  return { system, user }
}
