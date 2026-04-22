'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Lang, AppStep, QuestionResponse, StatementResponse, DiagnosticResults, Band, DimensionScore } from '@/lib/types'
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

// ── Main App ──
export default function ESDApp() {
  const [lang, setLang] = useState<Lang>('en')
  const [step, setStep] = useState<AppStep>('landing')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [responses, setResponses] = useState<QuestionResponse[]>([])
  const [results, setResults] = useState<DiagnosticResults | null>(null)
  const [reportText, setReportText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // ── Option B state ──
  const [mostId, setMostId] = useState<string | null>(null)
  const [leastId, setLeastId] = useState<string | null>(null)
  const [middleOrder, setMiddleOrder] = useState<string[]>([])
  const [contextText, setContextText] = useState('')
  const [selectionStep, setSelectionStep] = useState<'most' | 'least' | 'done'>('most')

  const t = useT(lang)
  const currentQuestion = QUESTIONS[questionIndex]
  const currentDim = currentQuestion ? DIMENSIONS.find(d => d.id === currentQuestion.dimensionId) : null
  const reportRef = useRef<HTMLDivElement>(null)

  // Reset state when question changes
  useEffect(() => {
    if (!currentQuestion) return
    const existing = responses.find(r => r.questionId === currentQuestion.id)
    if (existing) {
      const sorted = [...existing.statementResponses].sort((a, b) => a.rankPosition - b.rankPosition)
      setMostId(sorted[0]?.statementId ?? null)
      setLeastId(sorted[4]?.statementId ?? null)
      setMiddleOrder(sorted.slice(1, 4).map(s => s.statementId))
      setContextText(existing.contextExample)
      setSelectionStep('done')
    } else {
      setMostId(null)
      setLeastId(null)
      setMiddleOrder([])
      setContextText('')
      setSelectionStep('most')
    }
  }, [questionIndex, currentQuestion, responses])

  // Handle card click
  const handleCardClick = (stmtId: string) => {
    if (selectionStep === 'most') {
      setMostId(stmtId)
      setSelectionStep('least')
    } else if (selectionStep === 'least') {
      if (stmtId === mostId) return // Can't select same as most
      setLeastId(stmtId)
      // Auto-fill middle: remaining 3 in original display order
      const remaining = currentQuestion.statements
        .map(s => s.id)
        .filter(id => id !== mostId && id !== stmtId)
      setMiddleOrder(remaining)
      setSelectionStep('done')
    }
  }

  // Swap two middle cards
  const handleMiddleSwap = (idx: number) => {
    if (idx >= middleOrder.length - 1) return
    const newOrder = [...middleOrder]
    ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
    setMiddleOrder(newOrder)
  }

  // Reset selection
  const handleReset = () => {
    setMostId(null)
    setLeastId(null)
    setMiddleOrder([])
    setSelectionStep('most')
  }

  // Build response and save
  const buildResponse = useCallback((): QuestionResponse | null => {
    if (!currentQuestion || !mostId || !leastId || middleOrder.length !== 3) return null
    const statementResponses: StatementResponse[] = [
      { statementId: mostId, rankPosition: 0 },
      { statementId: middleOrder[0], rankPosition: 1 },
      { statementId: middleOrder[1], rankPosition: 2 },
      { statementId: middleOrder[2], rankPosition: 3 },
      { statementId: leastId, rankPosition: 4 },
    ]
    return { questionId: currentQuestion.id, statementResponses, contextExample: contextText }
  }, [currentQuestion, mostId, leastId, middleOrder, contextText])

  const saveAndNext = () => {
    const qr = buildResponse()
    if (!qr) return

    const updated = [...responses.filter(r => r.questionId !== currentQuestion.id), qr]

    if (questionIndex < QUESTIONS.length - 1) {
      setResponses(updated)
      setQuestionIndex(prev => prev + 1)
      window.scrollTo(0, 0)
    } else {
      // Last question — compute scores
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

  const isComplete = selectionStep === 'done'

  // ── Get card styling ──
  const getCardStyle = (stmtId: string) => {
    if (stmtId === mostId) return 'border-teal bg-teal-50 ring-2 ring-teal'
    if (stmtId === leastId) return 'border-rose bg-rose-50 ring-2 ring-rose'
    if (selectionStep === 'most') return 'border-gray-200 bg-white hover:border-teal/50 hover:bg-teal-50/30 cursor-pointer'
    if (selectionStep === 'least' && stmtId !== mostId) return 'border-gray-200 bg-white hover:border-rose/50 hover:bg-rose-50/30 cursor-pointer'
    return 'border-gray-200 bg-white'
  }

  const getCardLabel = (stmtId: string) => {
    if (stmtId === mostId) return t.mostLike
    if (stmtId === leastId) return t.leastLike
    const midIdx = middleOrder.indexOf(stmtId)
    if (midIdx >= 0) return `${midIdx + 2}${lang === 'en' ? ['nd', 'rd', 'th'][midIdx] : 'e'}`
    return null
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
            <p className="text-xs text-ink/40">19 questions · ~10 minutes · {t.poweredBy}</p>
          </div>
        )}

        {/* ── QUESTIONS (Option B) ── */}
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

            {/* Prompt */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink/70 uppercase tracking-wide">
                {selectionStep === 'most' ? t.stepMost : selectionStep === 'least' ? t.stepLeast : t.stepMiddle}
              </p>
              {selectionStep !== 'most' && (
                <button onClick={handleReset} className="text-xs text-ink/40 hover:text-ink underline">Reset</button>
              )}
            </div>

            {/* Statement cards */}
            <div className="space-y-3">
              {currentQuestion.statements.map((stmt) => {
                const label = getCardLabel(stmt.id)
                const isClickable = (selectionStep === 'most') || (selectionStep === 'least' && stmt.id !== mostId)
                const isMid = middleOrder.includes(stmt.id)
                const midIdx = middleOrder.indexOf(stmt.id)

                return (
                  <div key={stmt.id}
                    onClick={() => isClickable ? handleCardClick(stmt.id) : undefined}
                    className={`rounded-xl border-2 p-4 transition-all duration-200 ${getCardStyle(stmt.id)} ${isClickable ? '' : ''}`}>
                    <div className="flex items-start gap-3">
                      {/* Rank badge */}
                      {label && (
                        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold
                          ${stmt.id === mostId ? 'bg-teal text-white' : stmt.id === leastId ? 'bg-rose text-white' : 'bg-ink-50 text-ink/50'}`}>
                          {stmt.id === mostId ? '1st' : stmt.id === leastId ? '5th' : label}
                        </div>
                      )}
                      {!label && (
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-ink-50/50 flex items-center justify-center text-ink/20 text-lg">
                          {selectionStep === 'most' ? '○' : selectionStep === 'least' ? '○' : ''}
                        </div>
                      )}
                      <p className="text-sm text-ink leading-relaxed flex-1">{stmt.text[lang]}</p>
                      {/* Swap button for middle cards */}
                      {isMid && midIdx < middleOrder.length - 1 && selectionStep === 'done' && (
                        <button onClick={(e) => { e.stopPropagation(); handleMiddleSwap(midIdx) }}
                          className="flex-shrink-0 text-ink/30 hover:text-ink text-sm px-2 py-1 rounded hover:bg-ink-50">
                          ↕
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Context example */}
            {isComplete && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-ink/70 uppercase tracking-wide">{t.contextLabel}</h3>
                <p className="text-sm text-ink/50 italic">{currentQuestion.contextPrompt[lang]}</p>
                <textarea value={contextText} onChange={(e) => setContextText(e.target.value)}
                  placeholder={t.contextPlaceholder}
                  className="w-full h-24 rounded-xl border border-gray-200 p-4 text-sm text-ink resize-none focus:outline-none focus:ring-2 focus:ring-purple/30" />
              </div>
            )}

            {/* Nav buttons */}
            <div className="flex items-center justify-between pt-4">
              <button onClick={handlePrev} disabled={questionIndex === 0}
                className="text-ink/50 hover:text-ink disabled:opacity-30 font-medium">
                {t.previous}
              </button>
              <button onClick={saveAndNext} disabled={!isComplete}
                className={`rounded-xl px-8 py-3 font-semibold transition shadow-card ${
                  isComplete ? 'bg-purple text-white hover:bg-purple/90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
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
          <div className="space-y-10">
            <h1 className="text-3xl font-bold text-ink text-center">{t.dashboardTitle}</h1>

            {/* Overall */}
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-card text-center space-y-4">
              <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wide">{t.overallScore}</h2>
              <div className="flex justify-center"><ScoreGauge score={results.overallScore} band={results.overallBand} size={180} /></div>
              <BandBadge band={results.overallBand} lang={lang} />
            </div>

            {/* Dimensions */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-card overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wide">{t.dimensionScores}</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {results.dimensionScores.map(ds => {
                  const dim = DIMENSIONS.find(d => d.id === ds.dimensionId)
                  if (!dim) return null
                  return (
                    <div key={ds.dimensionId} className="px-6 py-4 flex items-center gap-4">
                      <div className="flex-1">
                        <p className="font-semibold text-ink text-sm">{dim.name[lang]}</p>
                        <p className="text-xs text-ink/40">{dim.system === 'Structural' ? t.structuralSystem : t.socialSystem} · {Math.round(dim.weight * 100)}%</p>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-ink">{Math.round(ds.score)}</span>
                          <BandBadge band={ds.band} lang={lang} />
                        </div>
                        {dim.hasDesignAdoption && ds.designScore !== undefined && ds.adoptionScore !== undefined && (
                          <p className="text-xs text-ink/40">{t.design}: {Math.round(ds.designScore)} · {t.adoption}: {Math.round(ds.adoptionScore)}</p>
                        )}
                        {ds.varianceFlag === 'High Variance' && (
                          <p className="text-xs text-orange font-medium">{t.highVariance}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Cascade gap */}
            {results.cascadeGap !== null && (
              <div className={`rounded-2xl border p-6 shadow-card ${results.cascadeGap > 30 ? 'border-rose bg-rose-50' : 'border-gray-200 bg-white'}`}>
                <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wide mb-3">{t.cascadeGap}</h2>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-ink">{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11a')?.score ?? 0)}</p>
                    <p className="text-xs text-ink/40">Q11a (Senior)</p>
                  </div>
                  <div className="text-2xl text-ink/30">\u2192</div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-ink">{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11b')?.score ?? 0)}</p>
                    <p className="text-xs text-ink/40">Q11b (Next layer)</p>
                  </div>
                  <div className="text-2xl text-ink/30">=</div>
                  <div className="text-center">
                    <p className={`text-2xl font-bold ${results.cascadeGap > 30 ? 'text-rose' : 'text-ink'}`}>{Math.round(results.cascadeGap)}</p>
                    <p className="text-xs text-ink/40">Gap</p>
                  </div>
                </div>
                {results.cascadeGap > 30 && <p className="mt-3 text-sm text-rose font-medium">{t.significantCascadeFailure}</p>}
              </div>
            )}

            {/* Patterns & FM */}
            <div className="grid grid-cols-2 gap-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-card">
                <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wide mb-3">{t.patternsDetected}</h2>
                {results.firedPatterns.length === 0 ? <p className="text-sm text-ink/40">{t.noneDetected}</p> : (
                  <ul className="space-y-2">{results.firedPatterns.map(p => (
                    <li key={p.patternId} className="text-sm text-ink font-medium">{PATTERNS[p.patternId]?.name[lang]}</li>
                  ))}</ul>
                )}
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-card">
                <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wide mb-3">{t.failureModesTriggered}</h2>
                {results.firedFailureModes.length === 0 ? <p className="text-sm text-ink/40">{t.noneDetected}</p> : (
                  <ul className="space-y-2">{results.firedFailureModes.map(f => (
                    <li key={f.failureModeId} className="text-sm text-rose font-medium">{FAILURE_MODES[f.failureModeId]?.name[lang]}</li>
                  ))}</ul>
                )}
              </div>
            </div>

            <div className="text-center">
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
                if (line.startsWith('- ')) return <p key={i} className="pl-4">\u2022 {line.slice(2)}</p>
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
