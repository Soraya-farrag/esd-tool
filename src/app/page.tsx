'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Lang, AppStep, QuestionResponse, StatementResponse, DiagnosticResults, Band } from '@/lib/types'
import { DIMENSIONS, QUESTIONS } from '@/lib/questions'
import { PATTERNS, FAILURE_MODES, ORB_BANDS } from '@/lib/interpretations'
import { computeAllScores, getBandColor, getBandLabel } from '@/lib/scoring'
import { buildReportPrompt } from '@/lib/prompts'
import { useT } from '@/lib/translations'

// ── Brand colours ──
const BRAND = {
  ink: '#151D33',
  teal: '#0DCBC4',
  orange: '#F79F20',
  purple: '#CB7CED',
  rose: '#E8466A',
}

// ── Score Gauge (gray track, teal fill, white number on dark bg) ──
function ScoreGauge({ score, band, size = 180 }: { score: number; band: Band; size?: number }) {
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const prog = (score / 100) * circ
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={BRAND.teal} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={circ - prog}
          strokeLinecap="round" className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-white">{Math.round(score)}</span>
        <span className="text-xs text-white/40">/100</span>
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

// ── RAG helpers for dimension cards ──
function getDimRAG(score: number): { border: string; bg: string; label: string; labelColor: string } {
  if (score >= 61) return { border: 'border-teal', bg: 'bg-teal-50', label: 'Strong', labelColor: 'text-teal' }
  if (score >= 41) return { border: 'border-orange', bg: 'bg-orange-50', label: 'Moderate', labelColor: 'text-orange' }
  return { border: 'border-rose', bg: 'bg-rose-50', label: 'Weak', labelColor: 'text-rose' }
}
function getDimRAGFr(score: number): string {
  if (score >= 61) return 'Solide'
  if (score >= 41) return 'Mod\u00e9r\u00e9'
  return 'Faible'
}

// ── Rank label + colour ──
function getRankLabel(pos: number, t: ReturnType<typeof useT>): string {
  if (pos === 0) return t.mostLike
  if (pos === 1) return t.rank2
  if (pos === 2) return t.rank3
  if (pos === 3) return t.rank4
  return t.leastLike
}
function getRankColor(pos: number): { bg: string; text: string; border: string; badge: string } {
  return [
    { bg: 'bg-teal-50/60', text: 'text-teal', border: 'border-teal/40', badge: 'bg-teal text-white' },
    { bg: 'bg-teal-50/30', text: 'text-teal/70', border: 'border-teal/20', badge: 'bg-teal/20 text-teal' },
    { bg: 'bg-gray-50/50', text: 'text-ink/40', border: 'border-gray-200', badge: 'bg-gray-100 text-ink/40' },
    { bg: 'bg-purple-50/30', text: 'text-purple/60', border: 'border-purple/20', badge: 'bg-purple/15 text-purple/60' },
    { bg: 'bg-purple-50/60', text: 'text-purple', border: 'border-purple/40', badge: 'bg-purple text-white' },
  ][pos] ?? { bg: 'bg-gray-50', text: 'text-ink/40', border: 'border-gray-200', badge: 'bg-gray-100 text-ink/40' }
}

// ── Drag-and-Drop Ranking ──
function DragRankCards({ rankedIds, statements, lang, t, onReorder }: {
  rankedIds: string[]; statements: { id: string; text: Record<string, string> }[];
  lang: Lang; t: ReturnType<typeof useT>; onReorder: (o: string[]) => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const isDragging = useRef(false)

  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    e.preventDefault(); isDragging.current = true; setDragIdx(idx); setOverIdx(idx)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || dragIdx === null) return; e.preventDefault()
    let newOver = dragIdx
    for (let i = 0; i < cardRefs.current.length; i++) {
      const card = cardRefs.current[i]; if (!card) continue
      const rect = card.getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) { newOver = i; break }
      newOver = i + 1
    }
    setOverIdx(Math.max(0, Math.min(rankedIds.length - 1, newOver)))
  }
  const handlePointerUp = () => {
    if (isDragging.current && dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const newOrder = [...rankedIds]; const [removed] = newOrder.splice(dragIdx, 1)
      newOrder.splice(overIdx, 0, removed); onReorder(newOrder)
    }
    isDragging.current = false; setDragIdx(null); setOverIdx(null)
  }

  const visualOrder = [...rankedIds]
  if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
    const [removed] = visualOrder.splice(dragIdx, 1); visualOrder.splice(overIdx, 0, removed)
  }

  return (
    <div ref={containerRef} className="space-y-2" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} style={{ touchAction: 'none' }}>
      {visualOrder.map((stmtId, pos) => {
        const stmt = statements.find(s => s.id === stmtId); if (!stmt) return null
        const rc = getRankColor(pos); const label = getRankLabel(pos, t)
        const isBeingDragged = dragIdx !== null && rankedIds[dragIdx] === stmtId
        return (
          <div key={stmtId} ref={(el) => { cardRefs.current[pos] = el }}
            onPointerDown={(e) => handlePointerDown(rankedIds.indexOf(stmtId), e)}
            className={`rounded-xl border-2 ${rc.border} ${rc.bg} p-4 select-none transition-all duration-150
              ${isBeingDragged ? 'shadow-lg scale-[1.02] ring-2 ring-purple/30 z-10 relative' : 'cursor-grab active:cursor-grabbing'}`}>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-ink/20">
                  <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
                  <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                  <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
                </svg>
                <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold ${rc.badge}`}>{label}</span>
              </div>
              <p className="text-sm text-ink leading-relaxed flex-1">{stmt.text[lang]}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Geometric triangles for landing ──
function GeoTriangles() {
  return (
    <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none overflow-hidden" aria-hidden>
      <svg className="w-full h-full opacity-[0.12]" viewBox="0 0 400 600" fill="none">
        <polygon points="200,50 350,200 50,200" fill={BRAND.teal} />
        <polygon points="280,180 400,380 160,380" fill={BRAND.purple} />
        <polygon points="100,320 300,320 200,500" fill={BRAND.orange} />
        <polygon points="320,400 380,550 260,550" fill={BRAND.teal} />
      </svg>
    </div>
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
  const [rankedIds, setRankedIds] = useState<string[]>([])
  const [contextText, setContextText] = useState('')

  const t = useT(lang)
  const currentQuestion = QUESTIONS[questionIndex]
  const currentDim = currentQuestion ? DIMENSIONS.find(d => d.id === currentQuestion.dimensionId) : null
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentQuestion) return
    const existing = responses.find(r => r.questionId === currentQuestion.id)
    if (existing) {
      const sorted = [...existing.statementResponses].sort((a, b) => a.rankPosition - b.rankPosition)
      setRankedIds(sorted.map(s => s.statementId)); setContextText(existing.contextExample)
    } else {
      setRankedIds(currentQuestion.statements.map(s => s.id)); setContextText('')
    }
  }, [questionIndex, currentQuestion, responses])

  const buildResponse = useCallback((): QuestionResponse | null => {
    if (!currentQuestion || rankedIds.length !== 5) return null
    return { questionId: currentQuestion.id, statementResponses: rankedIds.map((id, pos) => ({ statementId: id, rankPosition: pos })), contextExample: contextText }
  }, [currentQuestion, rankedIds, contextText])

  const saveAndNext = () => {
    const qr = buildResponse(); if (!qr) return
    const updated = [...responses.filter(r => r.questionId !== currentQuestion.id), qr]
    if (questionIndex < QUESTIONS.length - 1) { setResponses(updated); setQuestionIndex(prev => prev + 1); window.scrollTo(0, 0) }
    else { setStep('processing'); setTimeout(() => { setResults(computeAllScores(QUESTIONS, DIMENSIONS, updated)); setResponses(updated); setStep('dashboard') }, 2000) }
  }
  const handlePrev = () => {
    if (questionIndex > 0) { const qr = buildResponse(); if (qr) setResponses(prev => [...prev.filter(r => r.questionId !== currentQuestion.id), qr]); setQuestionIndex(prev => prev - 1); window.scrollTo(0, 0) }
  }
  const generateReport = async () => {
    if (!results) return; setStep('report'); setReportText(''); setIsStreaming(true)
    const { system, user } = buildReportPrompt(results, lang)
    try {
      const res = await fetch('/api/generate-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, user, lang }) })
      if (!res.ok) throw new Error('Failed'); const reader = res.body?.getReader(); if (!reader) throw new Error('No reader')
      const decoder = new TextDecoder()
      while (true) { const { done, value } = await reader.read(); if (done) break; setReportText(prev => prev + decoder.decode(value, { stream: true })) }
    } catch { setReportText(prev => prev + '\n\n[Error generating report. Please try again.]') }
    finally { setIsStreaming(false) }
  }

  const getStrengths = () => results?.dimensionScores.filter(ds => ds.score >= 61).sort((a, b) => b.score - a.score).slice(0, 3).map(ds => DIMENSIONS.find(d => d.id === ds.dimensionId)?.name[lang] ?? '') ?? []
  const getGaps = () => results?.dimensionScores.filter(ds => ds.score < 40).sort((a, b) => a.score - b.score).slice(0, 3).map(ds => DIMENSIONS.find(d => d.id === ds.dimensionId)?.name[lang] ?? '') ?? []
  const getStrengthDetails = () => results?.dimensionScores.filter(ds => ds.score >= 61).sort((a, b) => b.score - a.score).slice(0, 3).map(ds => {
    const dim = DIMENSIONS.find(d => d.id === ds.dimensionId)
    return { name: dim?.name[lang] ?? '', desc: dim?.description[lang] ?? '', score: Math.round(ds.score) }
  }) ?? []
  const getGapDetails = () => results?.dimensionScores.filter(ds => ds.score < 40).sort((a, b) => a.score - b.score).slice(0, 3).map(ds => {
    const dim = DIMENSIONS.find(d => d.id === ds.dimensionId)
    return { name: dim?.name[lang] ?? '', desc: dim?.description[lang] ?? '', score: Math.round(ds.score) }
  }) ?? []
  const getCascadeText = () => {
    if (results?.cascadeGap === null || results?.cascadeGap === undefined) return ''
    const q11a = Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11a')?.score ?? 0)
    const q11b = Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11b')?.score ?? 0)
    const gap = Math.round(Math.abs(results.cascadeGap))
    if (gap <= 10) return lang === 'en'
      ? `With a gap of only ${gap} points between the senior team (${q11a}) and the next layer (${q11b}), leadership intent remains consistent across organisational layers \u2014 suggesting strong translation between strategic direction and operational interpretation.`
      : `Avec un \u00e9cart de seulement ${gap} points entre l\u2019\u00e9quipe dirigeante (${q11a}) et le niveau suivant (${q11b}), l\u2019intention strat\u00e9gique reste coh\u00e9rente \u2014 ce qui sugg\u00e8re une bonne traduction entre direction strat\u00e9gique et interpr\u00e9tation op\u00e9rationnelle.`
    if (gap <= 30) return lang === 'en'
      ? `A gap of ${gap} points between the senior team (${q11a}) and the next layer (${q11b}) indicates that leadership intent shows moderate variation across layers. Strategic priorities may be interpreted differently as they cascade, creating uneven execution quality.`
      : `Un \u00e9cart de ${gap} points entre l\u2019\u00e9quipe dirigeante (${q11a}) et le niveau suivant (${q11b}) indique une variation mod\u00e9r\u00e9e de l\u2019intention strat\u00e9gique. Les priorit\u00e9s risquent d\u2019\u00eatre interpr\u00e9t\u00e9es diff\u00e9remment en cascadant, cr\u00e9ant une qualit\u00e9 d\u2019ex\u00e9cution in\u00e9gale.`
    return lang === 'en'
      ? `A gap of ${gap} points between the senior team (${q11a}) and the next layer (${q11b}) reveals a significant breakdown in leadership cascade. Strategic direction is being interpreted very differently \u2014 or actively resisted \u2014 as it moves through the organisation. This is one of the most critical execution risks detected.`
      : `Un \u00e9cart de ${gap} points entre l\u2019\u00e9quipe dirigeante (${q11a}) et le niveau suivant (${q11b}) r\u00e9v\u00e8le une rupture significative dans la cascade du leadership. La direction strat\u00e9gique est interpr\u00e9t\u00e9e tr\u00e8s diff\u00e9remment \u2014 ou activement r\u00e9sist\u00e9e \u2014 en traversant l\u2019organisation.`
  }
  const getOrbInterp = () => ORB_BANDS[results?.overallBand ?? 'amber']?.interpretation?.[lang] ?? ''

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="w-7 h-7" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span className="font-bold text-sm" style={{ color: BRAND.ink }}>{t.toolName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['en', 'fr'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${lang === l ? 'text-white' : 'text-ink/40 hover:text-ink/60'}`}
                style={lang === l ? { backgroundColor: BRAND.ink } : {}}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6">

        {/* ═══ LANDING ═══ */}
        {step === 'landing' && (
          <div className="relative min-h-[80vh] flex items-center">
            <GeoTriangles />
            <div className="relative z-10 max-w-xl py-20 space-y-8">
              {/* Pill badge */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full" style={{ backgroundColor: `${BRAND.teal}15` }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND.teal }} />
                <span className="text-xs font-semibold" style={{ color: BRAND.teal }}>{t.poweredBy}</span>
              </div>
              {/* Headline */}
              <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                <span style={{ color: BRAND.ink }}>{lang === 'en' ? 'Is your execution system' : 'Votre syst\u00e8me d\u2019ex\u00e9cution est-il'}</span><br/>
                <span style={{ color: BRAND.orange }}>{lang === 'en' ? 'ready for deployment?' : 'pr\u00eat pour le d\u00e9ploiement\u2009?'}</span>
              </h1>
              <p className="text-base text-ink/60 leading-relaxed max-w-lg">{t.toolDescription}</p>
              {/* CTA */}
              <button onClick={() => { setStep('question'); setQuestionIndex(0) }}
                className="rounded-xl px-8 py-4 font-semibold text-white hover:opacity-90 transition shadow-lg"
                style={{ backgroundColor: BRAND.purple }}>
                {t.startButton}
              </button>
              <p className="text-xs text-ink/35">19 questions</p>
              {/* When to use cards */}
              <div className="grid grid-cols-3 gap-4 pt-4">
                {[
                  { en: 'Before deployment', fr: 'Avant le d\u00e9ploiement', enSub: 'Know where the gaps are before you launch.', frSub: 'Identifiez les \u00e9carts avant le lancement.' },
                  { en: 'At leadership transition', fr: 'En transition de leadership', enSub: 'Get a structured baseline of what you inherit.', frSub: 'Obtenez un diagnostic structur\u00e9 de l\u2019existant.' },
                ].map((card, i) => (
                  <div key={i} className="space-y-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: BRAND.teal }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" fill="none"/></svg>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: BRAND.ink }}>{lang === 'en' ? card.en : card.fr}</p>
                    <p className="text-xs text-ink/40 leading-relaxed">{lang === 'en' ? card.enSub : card.frSub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ QUESTIONS ═══ */}
        {step === 'question' && currentQuestion && (
          <div className="max-w-3xl mx-auto py-12 space-y-8">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-ink/50">
                <span>{currentDim?.name[lang]} ({currentDim?.system === 'Structural' ? t.structuralSystem : t.socialSystem})</span>
                <span>{t.question} {questionIndex + 1} {t.of} {QUESTIONS.length}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${((questionIndex + 1) / QUESTIONS.length) * 100}%`, backgroundColor: BRAND.teal }} />
              </div>
            </div>
            <h2 className="text-xl font-bold leading-relaxed" style={{ color: BRAND.ink }}>{currentQuestion.text[lang]}</h2>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ink/60 uppercase tracking-wide">{t.rankInstruction}</p>
              <p className="text-xs text-ink/35">{t.rankHint}</p>
            </div>
            <DragRankCards rankedIds={rankedIds} statements={currentQuestion.statements} lang={lang} t={t} onReorder={setRankedIds} />
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold text-ink/60 uppercase tracking-wide">{t.contextLabel}</h3>
              <p className="text-xs text-ink/35 leading-relaxed">{t.contextHelper}</p>
              <textarea value={contextText} onChange={(e) => setContextText(e.target.value)} placeholder={t.contextPlaceholder}
                className="w-full h-28 rounded-xl border border-gray-200 p-4 text-sm text-ink resize-none focus:outline-none focus:ring-2 focus:ring-purple/30 bg-white" />
            </div>
            <div className="flex items-center justify-between pt-4">
              <button onClick={handlePrev} disabled={questionIndex === 0} className="text-ink/40 hover:text-ink disabled:opacity-20 font-medium">{t.previous}</button>
              <button onClick={saveAndNext} className="rounded-xl px-8 py-3 font-semibold text-white hover:opacity-90 transition shadow-md" style={{ backgroundColor: BRAND.purple }}>
                {questionIndex < QUESTIONS.length - 1 ? t.continueButton : t.seeResults}
              </button>
            </div>
          </div>
        )}

        {/* ═══ PROCESSING ═══ */}
        {step === 'processing' && (
          <div className="text-center space-y-6 py-32">
            <div className="w-12 h-12 mx-auto animate-spin"><img src="/icon.svg" alt="" className="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /></div>
            <h2 className="text-xl font-bold" style={{ color: BRAND.ink }}>{t.processingTitle}</h2>
            <p className="text-ink/40 text-sm">{t.processingSubtitle}</p>
          </div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {step === 'dashboard' && results && (
          <div className="py-12 space-y-8">

            {/* Score panel — dark ink background */}
            <div className="rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: BRAND.ink }}>
              <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: BRAND.teal }}>{t.overallScore}</p>
              <div className="flex justify-center"><ScoreGauge score={results.overallScore} band={results.overallBand} /></div>
              <BandBadge band={results.overallBand} lang={lang} />
              <p className="text-sm text-white/50 leading-relaxed max-w-xl mx-auto">{getOrbInterp()}</p>
            </div>

            {/* Executive Summary */}
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest">{t.executiveSummary}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                <div className="p-6 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: BRAND.teal }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white" style={{ backgroundColor: BRAND.teal }}>{'\u2713'}</span>
                      {t.strengths}
                    </p>
                    <p className="text-xs text-ink/30 mt-1.5 leading-relaxed">{t.strengthsExplain}</p>
                  </div>
                  {getStrengthDetails().length > 0 ? <ul className="space-y-2">{getStrengthDetails().map((s, i) => <li key={i}><p className="text-sm text-ink font-medium">{s.name} ({s.score})</p><p className="text-xs text-ink/40 mt-0.5 leading-relaxed">{s.desc}</p></li>)}</ul>
                    : <p className="text-sm text-ink/30 italic">{t.noStrengths}</p>}
                </div>
                <div className="p-6 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: BRAND.orange }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white" style={{ backgroundColor: BRAND.orange }}>{'\u26a0'}</span>
                      {t.priorityGaps}
                    </p>
                    <p className="text-xs text-ink/30 mt-1.5 leading-relaxed">{t.priorityGapsExplain}</p>
                  </div>
                  {getGapDetails().length > 0 ? <ul className="space-y-2">{getGapDetails().map((s, i) => <li key={i}><p className="text-sm text-ink font-medium">{s.name} ({s.score})</p><p className="text-xs text-ink/40 mt-0.5 leading-relaxed">{s.desc}</p></li>)}</ul>
                    : <p className="text-sm text-ink/30 italic">{t.noGaps}</p>}
                </div>
                <div className="p-6 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: BRAND.purple }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white" style={{ backgroundColor: BRAND.purple }}>{'\u2192'}</span>
                      {t.primaryTension}
                    </p>
                    <p className="text-xs text-ink/30 mt-1.5 leading-relaxed">{t.primaryTensionExplain}</p>
                  </div>
                  {results.firedPatterns.length > 0
                    ? <div><p className="text-sm text-ink font-medium">{PATTERNS[results.firedPatterns[0].patternId]?.name[lang]}</p><p className="text-xs text-ink/40 mt-0.5 leading-relaxed">{PATTERNS[results.firedPatterns[0].patternId]?.interpretation[lang]?.substring(0, 200)}...</p></div>
                    : <p className="text-sm text-ink/30 italic">{t.noTensions}</p>}
                </div>
              </div>
            </div>

            {/* Dimension Assessment */}
            <div>
                <h2 className="text-xs font-semibold text-ink/40 uppercase tracking-widest mb-4">{t.dimensionScores}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {results.dimensionScores.map(ds => {
                    const dim = DIMENSIONS.find(d => d.id === ds.dimensionId); if (!dim) return null
                    const rag = getDimRAG(ds.score)
                    return (
                      <div key={ds.dimensionId} className={`rounded-xl border-2 ${rag.border} ${rag.bg} p-5 transition hover:shadow-md`}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-semibold text-sm" style={{ color: BRAND.ink }}>{dim.name[lang]}</p>
                            <p className="text-xs text-ink/35 mt-0.5">{dim.system === 'Structural' ? t.structuralSystem : t.socialSystem} · {Math.round(dim.weight * 100)}%</p>
                          </div>
                          <span className="text-2xl font-bold" style={{ color: BRAND.ink }}>{Math.round(ds.score)}</span>
                        </div>
                        {dim.hasDesignAdoption && ds.designScore !== undefined && ds.adoptionScore !== undefined && (
                          <div className="flex items-center gap-4 mb-2">
                            <span className="text-xs text-ink/40">{t.design}: {Math.round(ds.designScore)}</span>
                            <span className="text-xs text-ink/40">{t.adoption}: {Math.round(ds.adoptionScore)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          {ds.varianceFlag === 'High Variance' && <p className="text-xs font-medium" style={{ color: BRAND.orange }}>{t.highVariance}</p>}
                          <p className={`text-xs font-bold ml-auto ${rag.labelColor}`}>{lang === 'en' ? rag.label : getDimRAGFr(ds.score)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
            </div>

            {/* Structural Tensions + Failure Modes — below Dimension Assessment */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border-2 border-rose bg-rose-50 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: BRAND.rose }}>{t.patternsDetected}</h3>
                {results.firedPatterns.length === 0 ? <p className="text-sm text-ink/30 italic">{t.noneDetected}</p> : (
                  <ul className="space-y-3">{results.firedPatterns.map(p => {
                    const pat = PATTERNS[p.patternId]; return (
                      <li key={p.patternId}><p className="text-sm font-semibold" style={{ color: BRAND.ink }}>{pat?.name[lang]}</p>
                        <p className="text-xs text-ink/40 mt-1 leading-relaxed">{pat?.interpretation[lang]?.substring(0, 120)}...</p></li>
                  )})}</ul>
                )}
              </div>
              <div className="rounded-xl border-2 border-orange bg-orange-50 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: BRAND.orange }}>{t.failureModesTriggered}</h3>
                {results.firedFailureModes.length === 0 ? <p className="text-sm text-ink/30 italic">{t.noneDetected}</p> : (
                  <ul className="space-y-3">{results.firedFailureModes.map(f => {
                    const fm = FAILURE_MODES[f.failureModeId]; return (
                      <li key={f.failureModeId}><p className="text-sm font-semibold" style={{ color: BRAND.ink }}>{fm?.name[lang]}</p>
                        <p className="text-xs text-ink/40 mt-1 leading-relaxed">{fm?.description[lang]?.substring(0, 120)}...</p></li>
                  )})}</ul>
                )}
              </div>
            </div>

            {/* Leadership Cascade Gap */}
            {results.cascadeGap !== null && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide mb-4">{t.cascadeGap}</h3>
                <div className="flex items-center gap-6 mb-4">
                  <div className="text-center"><p className="text-2xl font-bold" style={{ color: BRAND.ink }}>{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11a')?.score ?? 0)}</p><p className="text-xs text-ink/35">{t.senior}</p></div>
                  <span className="text-xl text-ink/20">{'\u2192'}</span>
                  <div className="text-center"><p className="text-2xl font-bold" style={{ color: BRAND.ink }}>{Math.round(results.dimensionScores.flatMap(d => d.questionScores).find(q => q.questionId === 'Q11b')?.score ?? 0)}</p><p className="text-xs text-ink/35">{t.nextLayer}</p></div>
                  <span className="text-xl text-ink/20">=</span>
                  <div className="text-center"><p className="text-2xl font-bold" style={{ color: Math.abs(results.cascadeGap) > 30 ? BRAND.orange : BRAND.ink }}>{Math.round(Math.abs(results.cascadeGap))}</p><p className="text-xs text-ink/35">{t.gap}</p></div>
                </div>
                <p className="text-sm text-ink/50 leading-relaxed">{getCascadeText()}</p>
              </div>
            )}

            <div className="text-center pt-4">
              <button onClick={generateReport} className="rounded-xl px-8 py-4 font-semibold text-white hover:opacity-90 transition shadow-lg" style={{ backgroundColor: BRAND.purple }}>{t.viewReport}</button>
            </div>
          </div>
        )}

        {/* ═══ REPORT ═══ */}
        {step === 'report' && (
          <div className="max-w-4xl mx-auto py-12 space-y-8">
            <div className="flex items-center justify-between">
              <button onClick={() => setStep('dashboard')} className="text-ink/40 hover:text-ink font-medium text-sm">{t.backToDashboard}</button>
              <button onClick={() => { setStep('landing'); setResponses([]); setResults(null); setReportText(''); setQuestionIndex(0) }} className="text-ink/40 hover:text-ink font-medium text-sm">{t.restartDiagnostic}</button>
            </div>
            <h1 className="text-2xl font-bold" style={{ color: BRAND.ink }}>{t.reportTitle}</h1>
            {isStreaming && reportText.length === 0 && (
              <div className="flex items-center gap-3 text-ink/40 text-sm">
                <div className="w-4 h-4 animate-spin"><img src="/icon.svg" alt="" className="w-full h-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /></div>
                <span>{t.generatingReport}</span>
              </div>
            )}
            <div ref={reportRef} className="rounded-2xl border border-gray-200 bg-white p-8 prose prose-sm max-w-none
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
              {isStreaming && <span className="inline-block w-2 h-5 animate-pulse ml-1" style={{ backgroundColor: BRAND.purple }} />}
            </div>
          </div>
        )}

      </main>

      <footer className="mt-20 border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <img src="/logo.svg" alt="Mosaic Shifter" className="h-5 mx-auto mb-3 opacity-40" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <p className="text-xs text-ink/25">&copy; {new Date().getFullYear()} Mosaic Shifter. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
