module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { subject, topic, question_summary, answer, steps, message } = req.body || {};
    if (!message) {
      res.status(400).json({ error: 'No follow-up request provided' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Server is not configured with an API key yet' });
      return;
    }

    const stepsText = Array.isArray(steps) && steps.length > 0 ? steps.join(' | ') : '(no steps given)';

    const prompt = `You are a patient study helper for a Nigerian secondary/university student. They already got this answer from you:

Subject: ${subject || 'unknown'}
Topic: ${topic || 'unknown'}
Question: ${question_summary || 'unknown'}
Steps given: ${stepsText}
Answer given: ${answer || 'unknown'}

The student now says: "${message}"

Respond directly and helpfully to that request, building on the context above. Keep it clear and concise (a few short sentences or a short numbered list where helpful). Do not repeat the whole original answer unless asked to. Reply in plain text only, no markdown code fences, no JSON.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) || 'AI request failed' });
      return;
    }

    const text = (data.content || []).map((b) => b.text || '').join('\n').trim();
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: 'Could not get a follow-up answer' });
  }
};
