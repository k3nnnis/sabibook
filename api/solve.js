const PROMPT = `You are a patient study helper for Nigerian secondary and university students looking at a photo of homework or exam questions.

The photo may contain ONE single question, or MULTIPLE numbered questions on one page, like a full exam page, worksheet, or textbook page. Identify and solve EVERY distinct question you can find in the image, up to a maximum of 15 questions. If there is genuinely only one question, return just that one.

The photo may show handwriting or printed text - possibly messy, slanted, cursive, in pencil or coloured pen, faint photocopy print, or photographed at an angle. Read it as carefully as an experienced teacher marking scripts would: look character by character, use context to resolve ambiguous letters or digits (e.g. a shaky "1" vs "7", a closed "4" vs "9"), and account for common student handwriting quirks and photocopy artifacts. This applies to EVERY subject - mathematics, sciences, English, government, literature, history, geography, accounting, everything.

For EACH question you find in the image:
1. Work out what the actual question is, reading carefully before concluding any part is unreadable.
2. Note the question's own printed number or label if visible (e.g. "1", "4", "7"). Leave it as an empty string if the image only has one unnumbered question.
3. Identify the subject (e.g. "Mathematics", "Physics", "English Language", "Government") and, if reasonably clear, the specific topic (e.g. "Quadratic Equations", "Simple Interest"). Leave topic as an empty string if it's not clearly identifiable - never guess wildly.
4. Decide if it is a mathematics / quantitative problem (arithmetic, algebra, calculus, physics or chemistry calculation, accounting, simple interest, etc.) or a non-quantitative subject (literature, biology theory, government, history, geography theory, English comprehension, etc).
5. If it is quantitative: solve it carefully and precisely, showing full working, and break it into short, clear numbered steps a student can follow, then give the final answer. Double-check arithmetic before finalizing. If it's multiple choice, state which lettered option is correct as part of the answer.
6. If it is non-quantitative: give the correct, concise answer. No long workings - 1-2 sentences of explanation at most.
7. Add a one-sentence "why_it_works": the plain-language reason the method or answer is correct, written so a student builds real understanding, not just copies the answer. Leave it as an empty string only if it genuinely wouldn't add anything.
8. Add a short, practical "exam_tip": one sentence a student could use in a real WAEC/NECO/JAMB exam related to this exact question or topic. Leave it as an empty string if nothing genuinely useful applies.

Only if the ENTIRE image is too blurry, dark, or cut off to make out any question even after careful reading, return a single question object with "subject_type": "unclear" and "answer" set to a short, specific tip for what to fix (e.g. "Too blurry to read - hold the camera steady and get closer"). Leave every other field as an empty string or empty array in that case.

Respond with ONLY valid JSON, no markdown code fences, no extra commentary, in exactly this shape:
{"questions": [{"question_number": "printed number or empty string", "subject_type": "math" or "other" or "unclear", "subject": "short subject name or empty string", "topic": "short topic name or empty string", "question_summary": "short restatement of the question", "steps": ["step 1", "step 2"], "answer": "the final answer, or a tip if unclear", "why_it_works": "one short sentence or empty string", "exam_tip": "one short sentence or empty string"}]}

If subject_type is "other" or "unclear" for a question, its "steps" must be an empty array. Always return this exact JSON shape, with "questions" as an array, even when there is only one question or the image is unclear.`;

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

async function incrementUsage(anonId, today, current, byCount) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !anonId || byCount <= 0) return;
  try {
    await supabaseFetch('usage_daily?on_conflict=anon_id,usage_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ anon_id: anonId, usage_date: today, question_count: current + byCount }),
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
    const remainingToday = FREE_DAILY_QUESTION_LIMIT - usedSoFar;

    if (!isPro && SUPABASE_URL && SUPABASE_SERVICE_KEY && remainingToday <= 0) {
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
            maxOutputTokens: 8000,
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

    let questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (questions.length === 0) {
      res.status(502).json({ error: 'Could not identify any question in that image.' });
      return;
    }

    const isUnclearOnly = questions.length === 1 && questions[0].subject_type === 'unclear';
    const answeredQuestions = questions.filter((q) => q.subject_type === 'math' || q.subject_type === 'other');
    let lockedCount = 0;
    let deliveredQuestions = questions;

    if (!isPro && SUPABASE_URL && SUPABASE_SERVICE_KEY && !isUnclearOnly) {
      if (answeredQuestions.length > remainingToday) {
        const keep = Math.max(remainingToday, 0);
        deliveredQuestions = questions.slice(0, keep);
        lockedCount = answeredQuestions.length - keep;
      }
    }

    const countToCharge = deliveredQuestions.filter((q) => q.subject_type === 'math' || q.subject_type === 'other').length;
    if (anon_id) {
      await incrementUsage(anon_id, today, usedSoFar, countToCharge);
    }

    res.status(200).json({ questions: deliveredQuestions, lockedCount, totalDetected: questions.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not solve this question' });
  }
};
