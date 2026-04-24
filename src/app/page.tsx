'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Lang, AppStep, QuestionResponse, StatementResponse, DiagnosticResults, Band } from '@/lib/types'
import { DIMENSIONS, QUESTIONS } from '@/lib/questions'
import { PATTERNS, FAILURE_MODES, ORB_BANDS } from '@/lib/interpretations'
import { computeAllScores, getBandColor, getBandLabel } from '@/lib/scoring'
import { buildReportPrompt } from '@/lib/prompts'
import { useT } from '@/lib/translations'

// ── Score Gauge ──
function ScoreGauge({ score, band, size = 160 }: { score: number; band: Band; size?: number }) {
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const prog = (score / 100) * circ
  const color = getBandColor(band)
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#EEF0F4" strokeWidth="10" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={circ - prog}
          strokeLinecap="round" className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-ink">{Math.round(score)}</span>
        <span className="text-xs text-ink/50">/100</span>
      </div>
    </div>
  )
}

function BandBadge({ band, lang }: { band: Band; lang: Lang }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: getBandColor(band) }}>
      {getBandLabel(band, lang)}
    </span>
  )
}

// ── Rank label + colour ──
function getRankLabel(pos: number, t: ReturnType<typeof useT>): string {
  if (pos === 0) return t.mostLike
  if (pos === 1) return t.rank2
  if (pos === 2) return t.rank3
  if (pos === 3) return t.rank4
  return t.leastLike
}

function getRankColor(pos: number): { bg: string; text: string; border: string } {
  const colors = [
    { bg: 'bg-teal/10', text: 'text-teal', border: 'border-teal' },        // 1st - teal
    { bg: 'bg-teal/5', text: 'text-teal/70', border: 'border-teal/40' },   // 2nd
    { bg: 'bg-gray-50', text: 'text-ink/40', border: 'border-gray-200' },   // 3rd - neutral
    { bg: 'bg-purple-50/50', text: 'text-purple/60', border: 'border-purple/30' }, // 4th
    { bg: 'bg-purple-50', text: 'text-purple', border: 'border-purple/50' }, // 5th - purple
  ]
  return colors[pos] ?? colors[2]
}

// ── Main App ──
export default function ESDApp() {
  const [lang, setLang] = useState<Lang>('en')
  const [step, setStep] = useState<AppStep>('landing')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [responses, setResponses] = useState<QuestionResponse[]>([])
  const [results, setResults] = useState<DiagnosticResults | null>(null)
  const [reportText, setReportText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // ── Drag-and-drop state ──
  const [rankedIds, setRankedIds] = useState<string[]>([])
  const [contextText, setContextText] = useState('')

  const t = useT(lang)
  const currentQuestion = QUESTIONS[questionIndex]
  const currentDim = currentQuestion ? DIMENSIONS.find(d => d.id === currentQuestion.dimensionId) : null
  const reportRef = useRef<HTMLDivElement>(null)

  // Reset ranking when question changes
  useEffect(() => {
    if (!currentQuestion) return
    const existing = responses.find(r => r.questionId === currentQuestion.id)
    if (existing) {
      const sorted = [...existing.statementResponses].sort((a, b) => a.rankPosition - b.rankPosition)
      setRankedIds(sorted.map(s => s.statementId))
      setContextText(existing.contextExample)
    } else {
      // Default order: as displayed
      setRankedIds(currentQuestion.statements.map(s => s.id))
      setContextText('')
    }
  }, [questionIndex, currentQuestion, responses])

  // Move card up/down
  const moveCard = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= rankedIds.length) return
    const newOrder = [...rankedIds]
    ;[newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]]
    setRankedIds(newOrder)
  }

  // Build response
  const buildResponse = useCallback((): QuestionResponse | null => {
    if (!currentQuestion || rankedIds.length !== 5) return null
    const statementResponses: StatementResponse[] = rankedIds.map((id, pos) => ({
      statementId: id,
      rankPosition: pos,
    }))
    return { questionId: currentQuestion.id, statementResponses, contextExample: contextText }
  }, [currentQuestion, rankedIds, contextText])

  const saveAndNext = () => {
    const qr = buildResponse()
    if (!qr) return
    const updated = [...responses.filter(r => r.questionId !== currentQuestion.id), qr]

    if (questionIndex < QUESTIONS.length - 1) {
      setResponses(updated)
      setQuestionIndex(prev => prev + 1)
      window.scrollTo(0, 0)
    } else {
      setStep('processing')
      setTimeout(() => {
        const computed = computeAllScores(QUESTIONS, DIMENSIONS, updated)
        setResults(computed)
        setResponses(updated)
        setStep('dashboard')
      }, 2000)
    }
  }

  const handlePrev = () => {
    if (questionIndex > 0) {
      const qr = buildResponse()
      if (qr) setResponses(prev => [...prev.filter(r => r.questionId !== currentQuestion.id), qr])
      setQuestionIndex(prev => prev - 1)
      window.scrollTo(0, 0)
    }
  }

  const generateReport = async () => {
    if (!results) return
    setStep('report'); setReportText(''); setIsStreaming(true)
    const { system, user } = buildReportPrompt(results, lang)
    try {
      const response = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, user, lang }),
      })
      if (!response.ok) throw new Error('Failed')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setReportText(prev => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      console.error(err)
      setReportText(prev => prev + '\n\n[Error generating report. Please try again.]')
    } finally { setIsStreaming(false) }
  }

  // ── Helpers for results page ──
  const getStrengths = () => {
    if (!results) return []
    return results.dimensionScores
      .filter(ds => ds.score >= 61)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(ds => DIMENSIONS.find(d => d.id === ds.dimensionId)?.name[lang] ?? ds.dimensionId)
  }

  const getGaps = () => {
    if (!results) return []
    return results.dimensionScores
      .filter(ds => ds.score < 40)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(ds => DIMENSIONS.find(d => d.id === ds.dimensionId)?.name[lang] ?? ds.dimensionId)
  }

  const getCascadeText = () => {
    if (!results || results.cascadeGap === null) return ''
    if (Math.abs(results.cascadeGap) <= 10) return t.cascadeGapStrong
    if (Math.abs(results.cascadeGap) <= 30) return t.cascadeGapModerate
    return t.cascadeGapWeak
  }

  const getOrbInterpretation = () => {
    if (!results) return ''
    return ORB_BANDS[results.overallBand]?.interpretation?.[lang] ?? ''
  }

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-teal-50/30 to-purple-50/20">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="w-8 h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span className="font-bold text-ink text-sm">{t.toolName}</span>
          </div>
          <div className="flex items-center gap-2">
            {(['en', 'fr'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${lang === l ? 'bg-ink text-white' : 'text-ink/50 hover:bg-ink-50'}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">

        {/* ── LANDING ── */}
        {step === 'landing' && (
          <div className="text-center max-w-2xl mx-auto space-y-8">
            <h1 className="text-4xl font-bold text-ink">{t.toolName}</h1>
            <p className="text-lg text-ink/70">{t.toolTagline}</p>
            <p className="text-ink/60 leading-relaxed">{t.toolDescription}</p>
            <button onClick={() => { setStep('question'); setQuestionIndex(0) }}
              className="bg-purple text-white rounded-xl px-8 py-4 font-semibold hover:bg-purple/90 transition shadow-card">
              {t.startButton}
            </button>
            <p className="text-xs text-ink/40">19 questions · ~12 minutes · {t.poweredBy}</p>
          </div>
        )}

        {/* ── QUESTIONS (Drag-and-drop ranking) ── */}
        {step === 'question' && currentQuestion && (
          <div className="space-y-8">
            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-ink/50">
                <span>{currentDim?.name[lang]} ({currentDim?.system === 'Structural' ? t.structuralSystem : t.socialSystem})</span>
                <span>{t.question} {questionIndex + 1} {t.of} {QUESTIONS.length}</span>
              </div>
              <div className="h-2 bg-ink-50 rounded-full overflow-hidden">
                <div className="h-full bg-teal rounded-full transition-all duration-500"
                  style={{ width: `${((questionIndex + 1) / QUESTIONS.length) * 100}%` }} />
              </div>
            </div>

            {/* Question */}
            <h2 className="text-xl font-bold text-ink leading-relaxed">{currentQuestion.text[lang]}</h2>

            {/* Ranking instruction */}
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ink/70 uppercase tracking-wide">{t.rankInstruction}</p>
              <p className="text-xs text-ink/40">{t.rankHint}</p>
            </div>

            {/* Ranked statement cards */}
            <div className="space-y-2">
              {rankedIds.map((stmtId, pos) => {
                const stmt = currentQuestion.statements.find(s => s.id === stmtId)
                if (!stmt) return null
                const rc = getRankColor(pos)
                const label = getRankLabel(pos, t)

                return (
                  <div key={stmtId}
                    className={`rounded-xl border-2 ${rc.border} ${rc.bg} p-4 transition-all duration-200`}>
                    <div className="flex items-start gap-3">
                      {/* Rank badge */}
                      <div className={`flex-shrink-0 w-16 text-center`}>
                        <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${rc.text} ${rc.bg}`}>
                          {label}
                        </span>
                      </div>

                      {/* Statement text */}
                      <p className="text-sm text-ink leading-relaxed flex-1">{stmt.text[lang]}</p>

                      {/* Up/Down arrows */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => moveCard(pos, -1)}
                          disabled={pos === 0}
                          className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-20 disabled:cursor-not-allowed transition">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2L10 7H2L6 2Z" fill="currentColor"/></svg>
                        </button>
                        <button
                          onClick={() => moveCard(pos, 1)}
                          disabled={pos === rankedIds.length - 1}
                          className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-ink/40 hover:text-ink hover:border-ink/30 disabled:opacity-20 disabled:cursor-not-allowed transition">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 10L2 5H10L6 10Z" fill="currentColor"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Contextual intelligence textbox */}
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold text-ink/70 uppercase tracking-wide">{t.contextLabel}</h3>
              <p className="text-xs text-ink/40 leading-relaxed">{t.contextHelper}</p>
              <textarea value={contextText} onChange={(e) => setContextText(e.target.value)}
                placeholder={t.contextPlaceholder}
                className="w-full h-28 rounded-xl border border-gray-200 p-4 text-sm text-ink resize-none focus:outline-none focus:ring-2 focus:ring-purple/30 bg-white" />
            </div>

            {/* Nav buttons */}
            <div className="flex items-center justify-between pt-4">
              <button onClick={handlePrev} disabled={questionIndex === 0}
                className="text-ink/50 hover:text-ink disabled:opacity-30 font-medium">
                {t.previous}
              </button>
              <button onClick={saveAndNext}
                className="bg-purple text-white rounded-xl px-8 py-3 font-semibold hover:bg-purple/90 transition shadow-card">
                {questionIndex < QUESTIONS.length - 1 ? t.continueButton : t.seeResults}
              </button>
            </div>
          </div>
        )}

        {/* ── PROCESSING ── */}
        {step === 'processing' && (
          <div className="text-center space-y-6 py-20">
            <div className="w-16 h-16 mx-auto animate-spin">
              <img src="/icon.svg" alt="" className="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <h2 className="text-2xl font-bold text-ink">{t.processingTitle}</h2>
            <p className="text-ink/50">{t.processingSubtitle}</p>
          </div>
        )}

        {/* ── DASHBOARD ── */}
        {step === 'dashboard' && results && (
          <div className="space-y-8">
            <h1 className="text-2xl font-bold text-ink text-center">{t.dashboardTitle}</h1>

            {/* Overall Score */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-card text-center space-y-4">
              <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.overallScore}</h2>
              <div className="flex justify-center"><ScoreGauge score={results.overallScore} band={results.overallBand} size={180} /></div>
              <BandBadge band={results.overallBand} lang={lang} />
              <p className="text-sm text-ink/60 leading-relaxed max-w-xl mx-auto">{getOrbInterpretation()}</p>
            </div>

            {/* Executive Summary */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-card overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.executiveSummary}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                {/* Strengths */}
                <div className="p-6 space-y-2">
                  <p className="text-xs font-semibold text-teal uppercase tracking-wide flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-teal/10 flex items-center justify-center text-teal text-xs">{'\u2713'}</span>
                    {t.strengths}
                  </p>
                  {getStrengths().length > 0 ? (
                    <ul className="space-y-1">{getStrengths().map((s, i) => (
                      <li key={i} className="text-sm text-ink">{s}</li>
                    ))}</ul>
                  ) : <p className="text-sm text-ink/40">{t.noStrengths}</p>}
                </div>
                {/* Priority gaps */}
                <div className="p-6 space-y-2">
                  <p className="text-xs font-semibold text-orange uppercase tracking-wide flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-orange/10 flex items-center justify-center text-orange text-xs">{'\u26a0'}</span>
                    {t.priorityGaps}
                  </p>
                  {getGaps().length > 0 ? (
                    <ul className="space-y-1">{getGaps().map((s, i) => (
                      <li key={i} className="text-sm text-ink">{s}</li>
                    ))}</ul>
                  ) : <p className="text-sm text-ink/40">{t.noGaps}</p>}
                </div>
                {/* Primary tension */}
                <div className="p-6 space-y-2">
                  <p className="text-xs font-semibold text-purple uppercase tracking-wide flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple/10 flex items-center justify-center text-purple text-xs">{'\u2192'}</span>
                    {t.primaryTension}
                  </p>
                  {results.firedPatterns.length > 0 ? (
                    <p className="text-sm text-ink">{PATTERNS[results.firedPatterns[0].patternId]?.name[lang]}</p>
                  ) : <p className="text-sm text-ink/40">{t.noTensions}</p>}
                </div>
              </div>
            </div>

            {/* Dimension Scorecards — 2 column grid */}
            <div>
              <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest mb-4">{t.dimensionScores}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.dimensionScores.map(ds => {
                  const dim = DIMENSIONS.find(d => d.id === ds.dimensionId)
                  if (!dim) return null
                  const orbText = ORB_BANDS[ds.band]?.interpretation?.[lang] ?? ''
                  return (
                    <div key={ds.dimensionId} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-card transition">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-ink text-sm">{dim.name[lang]}</p>
                          <p className="text-xs text-ink/40 mt-0.5">{dim.system === 'Structural' ? t.structuralSystem : t.socialSystem} · {Math.round(dim.weight * 100)}%</p>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="text-2xl font-bold text-ink">{Math.round(ds.score)}</span>
                          <BandBadge band={ds.band} lang={lang} />
                        </div>
                      </div>
                      {dim.hasDesignAdoption && ds.designScore !== undefined && ds.adoptionScore !== undefined && (
                        <div className="flex items-center gap-4 mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-teal/40" />
                            <span className="text-xs text-ink/50">{t.design}: {Math.round(ds.designScore)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-purple/40" />
                            <span className="text-xs text-ink/50">{t.adoption}: {Math.round(ds.adoptionScore)}</span>
                          </div>
                        </div>
                      )}
                      {ds.varianceFlag === 'High Variance' && (
                        <p className="text-xs text-orange font-medium mb-1">{t.highVariance}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Leadership Cascade — human-readable */}
            {results.cascadeGap !== null && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-card overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.cascadeGap}</h2>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-8 mb-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-ink">{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11a')?.score ?? 0)}</p>
                      <p className="text-xs text-ink/40">{t.senior}</p>
                    </div>
                    <div className="text-xl text-ink/20">{'\u2192'}</div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-ink">{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11b')?.score ?? 0)}</p>
                      <p className="text-xs text-ink/40">{t.nextLayer}</p>
                    </div>
                    <div className="text-xl text-ink/20">=</div>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${Math.abs(results.cascadeGap) > 30 ? 'text-orange' : 'text-ink'}`}>{Math.round(Math.abs(results.cascadeGap))}</p>
                      <p className="text-xs text-ink/40">{t.gap}</p>
                    </div>
                  </div>
                  <p className="text-sm text-ink/60 leading-relaxed">{getCascadeText()}</p>
                </div>
              </div>
            )}

            {/* Patterns & Failure Modes — with explanations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Patterns */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-card overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.patternsDetected}</h2>
                </div>
                <div className="p-6">
                  {results.firedPatterns.length === 0 ? <p className="text-sm text-ink/40">{t.noneDetected}</p> : (
                    <ul className="space-y-4">{results.firedPatterns.map(p => {
                      const pat = PATTERNS[p.patternId]
                      return (
                        <li key={p.patternId}>
                          <p className="text-sm font-semibold text-ink">{pat?.name[lang]}</p>
                          <p className="text-xs text-ink/50 mt-1 leading-relaxed">{pat?.interpretation[lang]?.substring(0, 150)}...</p>
                        </li>
                      )
                    })}</ul>
                  )}
                </div>
              </div>
              {/* Failure Modes */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-card overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.failureModesTriggered}</h2>
                </div>
                <div className="p-6">
                  {results.firedFailureModes.length === 0 ? <p className="text-sm text-ink/40">{t.noneDetected}</p> : (
                    <ul className="space-y-4">{results.firedFailureModes.map(f => {
                      const fm = FAILURE_MODES[f.failureModeId]
                      return (
                        <li key={f.failureModeId}>
                          <p className="text-sm font-semibold text-ink">{fm?.name[lang]}</p>
                          <p className="text-xs text-ink/50 mt-1 leading-relaxed">{fm?.description[lang]?.substring(0, 150)}...</p>
                        </li>
                      )
                    })}</ul>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center pt-4">
              <button onClick={generateReport}
                className="bg-purple text-white rounded-xl px-8 py-4 font-semibold hover:bg-purple/90 transition shadow-card">
                {t.viewReport}
              </button>
            </div>
          </div>
        )}

        {/* ── REPORT ── */}
        {step === 'report' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <button onClick={() => setStep('dashboard')} className="text-ink/50 hover:text-ink font-medium">{t.backToDashboard}</button>
              <button onClick={() => { setStep('landing'); setResponses([]); setResults(null); setReportText(''); setQuestionIndex(0) }}
                className="text-ink/50 hover:text-ink font-medium text-sm">{t.restartDiagnostic}</button>
            </div>
            <h1 className="text-3xl font-bold text-ink">{t.reportTitle}</h1>
            {isStreaming && reportText.length === 0 && (
              <div className="flex items-center gap-3 text-ink/50">
                <div className="w-5 h-5 animate-spin"><img src="/icon.svg" alt="" className="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /></div>
                <span>{t.generatingReport}</span>
              </div>
            )}
            <div ref={reportRef}
              className="rounded-2xl border border-gray-200 bg-white p-8 shadow-card prose prose-sm max-w-none
                prose-headings:text-ink prose-p:text-ink/80 prose-strong:text-ink
                prose-h2:text-xl prose-h2:font-bold prose-h2:mt-8 prose-h2:mb-4 prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-3
                prose-h3:text-lg prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-3
                prose-h4:text-base prose-h4:font-semibold prose-h4:mt-4 prose-h4:mb-2">
              {reportText.split('\n').map((line, i) => {
                if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>
                if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>
                if (line.startsWith('#### ')) return <h4 key={i}>{line.slice(5)}</h4>
                if (line.startsWith('**') && line.endsWith('**')) return <p key={i}><strong>{line.slice(2, -2)}</strong></p>
                if (line.startsWith('- ')) return <p key={i} className="pl-4">{'\u2022'} {line.slice(2)}</p>
                if (line.startsWith('---')) return <hr key={i} className="my-6 border-gray-200" />
                if (line.trim() === '') return <br key={i} />
                return <p key={i}>{line}</p>
              })}
              {isStreaming && <span className="inline-block w-2 h-5 bg-purple animate-pulse ml-1" />}
            </div>
          </div>
        )}

      </main>

      <footer className="mt-20 border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <img src="/logo.svg" alt="Mosaic Shifter" className="h-6 mx-auto mb-3 opacity-50" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <p className="text-xs text-ink/30">&copy; {new Date().getFullYear()} Mosaic Shifter. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
