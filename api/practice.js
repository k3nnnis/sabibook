const GEMINI_MODEL = 'gemini-3.6-flash';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { subject, topic, subject_type, question_summary } = req.body || {};
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'Server is not configured with an API key yet' });
      return;
    }

    const prompt = `You are writing one new practice question for a Nigerian secondary/university student, at a WAEC/NECO/JAMB curriculum level.

The student just solved this:
Subject: ${subject || 'unknown'}
Topic: ${topic || 'unknown'}
Original question: ${question_summary || 'unknown'}
Type: ${subject_type || 'other'}

Write ONE new question testing the same concept and similar difficulty - genuinely different from the original, not the same numbers/wording changed slightly. Then solve it yourself for reference: if it's quantitative, give short numbered steps and a final answer; if not, give a concise correct answer.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"question": "the new practice question", "subject_type": "math" or "other", "steps": ["step 1", "step 2"], "answer": "the reference answer"}

If subject_type is "other", "steps" must be an empty array.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 1200,
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

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Could not generate a practice question' });
  }
};
