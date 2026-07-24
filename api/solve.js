const PROMPT = `You are a patient study helper for Nigerian secondary and university students looking at a photo of a homework or exam question.

Look at the image and:
1. Work out what the actual question is.
2. Decide if it is a mathematics / quantitative problem (arithmetic, algebra, calculus, physics or chemistry calculation, accounting, etc.) or a non-quantitative subject (literature, biology theory, government, history, geography theory, English comprehension, etc).
3. If it is quantitative: solve it and break the working into short, clear numbered steps a student can follow, then give the final answer.
4. If it is non-quantitative: just give the correct, concise answer. No long workings - 1-2 sentences of explanation at most.

Respond with ONLY valid JSON, no markdown code fences, no extra commentary, in exactly this shape:
{"subject_type": "math" or "other", "question_summary": "short restatement of the question", "steps": ["step 1", "step 2"], "answer": "the final answer as a string"}

If subject_type is "other", "steps" must be an empty array.`;

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
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Could not solve this question' });
  }
};
