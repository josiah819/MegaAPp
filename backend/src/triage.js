// Triage for guest-submitted facility reports.
// Keyword scoring always runs; if ANTHROPIC_API_KEY is set, Claude refines the
// result asynchronously (never blocks the submit path, never overrides a
// category the guest chose themselves).

const RULES = [
  { cat: 'safety',       urgency: 3, words: ['fire', 'smoke', 'gas', 'spark', 'shock', 'injur', 'blood', 'unsafe', 'danger', 'emergency', 'carbon', 'alarm'] },
  { cat: 'maintenance',  urgency: 2, words: ['leak', 'flood', 'burst', 'no heat', 'no power', 'outage', 'broken lock', 'door won'] },
  { cat: 'maintenance',  urgency: 1, words: ['broken', 'repair', 'fix', 'crack', 'squeak', 'stuck', 'drip', 'loose', 'light out', 'bulb'] },
  { cat: 'housekeeping', urgency: 1, words: ['clean', 'dirty', 'garbage', 'trash', 'towel', 'linen', 'smell', 'spill', 'wasp', 'mouse', 'bug'] },
  { cat: 'it',           urgency: 1, words: ['wifi', 'wi-fi', 'internet', 'projector', 'screen', 'sound', 'mic', 'hdmi', 'tv'] },
]

export function keywordTriage(text = '') {
  const t = text.toLowerCase()
  let best = { category: 'other', urgency: 1, summary: '', via: 'keywords' }
  for (const rule of RULES) {
    if (rule.words.some(w => t.includes(w))) {
      if (rule.urgency >= best.urgency || best.category === 'other') {
        best = { category: rule.cat, urgency: rule.urgency, summary: '', via: 'keywords' }
      }
    }
  }
  return best
}

export async function claudeTriage(text, categories) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `A camp guest reported a facility issue. Categorize it.\nCategories: ${categories.join(', ')}\nUrgency: 1 low, 2 high, 3 safety.\nReport: """${text.slice(0, 1200)}"""\nReply with only JSON: {"category":"...","urgency":1,"summary":"one short line"}`,
        }],
      }),
    })
    if (!res.ok) return null
    const j = await res.json()
    const raw = j.content?.[0]?.text || ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!categories.includes(parsed.category)) return null
    return { category: parsed.category, urgency: Math.min(3, Math.max(1, parsed.urgency | 0)), summary: String(parsed.summary || '').slice(0, 140), via: 'claude' }
  } catch {
    return null
  }
}
