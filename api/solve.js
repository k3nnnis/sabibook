const PROMPT = `You are a patient study helper for Nigerian secondary and university students looking at a photo of a homework or exam question.

The photo may show handwriting - possibly messy, slanted, cursive, in pencil or coloured pen, or photographed at an angle. Read it as carefully as an experienced teacher marking scripts would: look character by character, use context to resolve ambiguous letters or digits (e.g. a shaky "1" vs "7", a closed "4" vs "9"), and account for common student handwriting quirks. This applies to EVERY subject - mathematics, sciences, English, government, literature, history, geography, accounting, everything - not just typed or printed text.

Look at the image and:
1. Work out what the actual question is, reading any handwriting as diligently as possible before concluding it's unreadable.
2. Identify the subject (e.g. "Mathematics", "Physics", "English Language", "Government") and, if reasonably clear, the specific topic (e.g. "Quadratic Equations", "Photosynthesis"). Leave topic as an empty string if it's not clearly identifiable - never guess wildly.
3. Decide if it is a mathematics / quantitative problem (arithmetic, algebra, calculus, physics or chemistry calculation, accounting, etc.) or a non-quantitative subject (literature, biology theory, government, history, geography theory, English comprehension, etc).
4. If it is quantitative: solve it carefully and precisely, showing full working, and break it into short, clear numbered steps a student can follow, then give the final answer. Double-check arithmetic before finalizing.
5. If it is non-quantitative: just give the correct, concise answer. No long workings - 1-2 sentences of explanation at most.
6. Add a one-sentence "why_it_works" - the plain-language reason the method or answer is correct, written so a student builds real understanding, not just copies the answer. Leave it as an empty string only if it genuinely wouldn't add anything (e.g. a simple factual recall question).
7. Add a short, practical "exam_tip" - one sentence a student could use in a real WAEC/NECO/JAMB exam related to this exact question or topic. Leave it as an empty string if nothing genuinely useful applies.
8. Only if the image is genuinely too blurry, dark, or cut off to make out the question even after careful reading, use "subject_type": "unclear" instead, with "answer" set to a short, specific tip for what to fix (e.g. "The bottom line is cut off - try including the whole question" or "Too blurry to read - hold the camera steady and get closer"). Leave subject, topic, why_it_works, and exam_tip as empty strings in this case.

Respond with ONLY valid JSON, no markdown code fences, no extra commentary, in exactly this shape:
{"subject_type": "math" or "other" or "unclear", "subject": "short subject name or empty string", "topic": "short topic name or empty string", "question_summary": "short restatement of the question", "steps": ["step 1", "step 2"], "answer": "the final answer, or a tip if unclear", "why_it_works": "one short sentence or empty string", "exam_tip": "one short sentence or empty string"}

If subject_type is "other" or "unclear", "steps" must be an empty array. Always return this exact JSON shape, never plain text, even when the image is unclear.`;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FREE_DAILY_QUESTION_LIMIT = 5;
const GEMINI_MODEL = 'gemini-3.6-flash';

function lagosDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function supabaseFetch(path, options) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });
}

async function getProStatus(anonId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !anonId) return false;
  try {
    const r = await supabaseFetch(`subscriptions?anon_id=eq.${encodeURIComponent(anonId)}&select=status,expires_at`);
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) {
      const s = rows[0];
      return s.status === 'active' && s.expires_at && new Date(s.expires_at).getTime() > Date.now();
    }
  } catch (e) { /* fail open to free tier below */ }
  return false;
}

async function getUsageCount(anonId, today) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !anonId) return 0;
  try {
    const r = await supabaseFetch(`usage_daily?anon_id=eq.${encodeURIComponent(anonId)}&usage_date=eq.${today}&select=question_count`);
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0].question_count : 0;
  } catch (e) { return 0; }
}

async function incrementUsage(anonId, today, current) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !anonId) return;
  try {
    await supabaseFetch('usage_daily?on_conflict=anon_id,usage_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ anon_id: anonId, usage_date: today, question_count: current + 1 }),
    });
  } catch (e) { /* non-critical */ }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { imageBase64, mediaType, anon_id } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'Server is not configured with an API key yet' });
      return;
    }

    const today = lagosDateKey(new Date());
    const isPro = await getProStatus(anon_id);
    const usedSoFar = await getUsageCount(anon_id, today);

    if (!isPro && SUPABASE_URL && SUPABASE_SERVICE_KEY && usedSoFar >= FREE_DAILY_QUESTION_LIMIT) {
      res.status(200).json({
        limitReached: true,
        dailyLimit: FREE_DAILY_QUESTION_LIMIT,
        message: `You've used your ${FREE_DAILY_QUESTION_LIMIT} free questions for today. Come back tomorrow, or go Pro for higher daily access.`,
      });
      return;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 3000,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) || 'AI request failed' });
      return;
    }

    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((p) => p.text || '').join('\n')
      : '';

    if (!text) {
      res.status(502).json({ error: 'AI returned an empty response. Try again.' });
      return;
    }

    let clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw parseErr;
      }
    }

    if (anon_id) {
      await incrementUsage(anon_id, today, usedSoFar);
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Could not solve this question' });
  }
};
