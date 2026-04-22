// ═══════════════════════════════════════
// ESD v2 — Report Generation API Route
// ═══════════════════════════════════════

import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { system, user, lang } = await request.json()

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      )
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: system,
        stream: true,
        messages: [{ role: 'user', content: user }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', errorText)
      return NextResponse.json(
        { error: 'AI service error' },
        { status: response.status }
      )
    }

    // Stream the SSE response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader()
        if (!reader) {
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  controller.enqueue(encoder.encode(parsed.delta.text))
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }
        } catch (error) {
          console.error('Stream error:', error)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
