const PROMPT = `You are a patient study helper for Nigerian secondary and university students looking at a photo of a homework or exam question.

The photo may show handwriting - possibly messy, slanted, cursive, in pencil or coloured pen, or photographed at an angle. Read it as carefully as an experienced teacher marking scripts would: look character by character, use context to resolve ambiguous letters or digits (e.g. a shaky "1" vs "7", a closed "4" vs "9"), and account for common student handwriting quirks. This applies to EVERY subject - mathematics, sciences, English, government, literature, history, geography, accounting, everything - not just typed or printed text.

Look at the image and:
1. Work out what the actual question is, reading any handwriting as diligently as possible before concluding it's unreadable.
2. Decide if it is a mathematics / quantitative problem (arithmetic, algebra, calculus, physics or chemistry calculation, accounting, etc.) or a non-quantitative subject (literature, biology theory, government, history, geography theory, English comprehension, etc).
3. If it is quantitative: solve it and break the working into short, clear numbered steps a student can follow, then give the final answer.
4. If it is non-quantitative: just give the correct, concise answer. No long workings - 1-2 sentences of explanation at most.
5. Only if the image is genuinely too blurry, dark, or cut off to make out the question even after careful reading, use "subject_type": "unclear" instead, with "answer" set to a short, specific tip for what to fix (e.g. "The bottom line is cut off - try including the whole question" or "Too blurry to read - hold the camera steady and get closer").

Respond with ONLY valid JSON, no markdown code fences, no extra commentary, in exactly this shape:
{"subject_type": "math" or "other" or "unclear", "question_summary": "short restatement of the question", "steps": ["step 1", "step 2"], "answer": "the final answer, or a tip if unclear"}

If subject_type is "other" or "unclear", "steps" must be an empty array. Always return this exact JSON shape, never plain text, even when the image is unclear.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { imageBase64, mediaType } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Server is not configured with an API key yet' });
      return;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) || 'AI request failed' });
      return;
    }

    const text = (data.content || []).map((b) => b.text || '').join('\n');
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
    res.status(500).json({ error: 'Could not solve this question' });
  }
};
