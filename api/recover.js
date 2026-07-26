const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { anon_id, recovery_code } = req.body || {};
    if (!anon_id || !recovery_code) {
      res.status(400).json({ error: 'Missing anon_id or recovery_code' });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      res.status(500).json({ error: 'Recovery is not available yet' });
      return;
    }

    const now = Date.now();
    const attemptRes = await supabaseFetch(`recovery_attempts?anon_id=eq.${encodeURIComponent(anon_id)}&select=*`);
    const attemptRows = await attemptRes.json();
    let attempts = 0;
    let windowStart = now;
    if (Array.isArray(attemptRows) && attemptRows.length > 0) {
      const row = attemptRows[0];
      const rowWindowStart = new Date(row.window_start).getTime();
      if ((now - rowWindowStart) < WINDOW_MS) {
        attempts = row.attempts;
        windowStart = rowWindowStart;
      }
    }
    if (attempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: 'Too many attempts. Try again in a while.' });
      return;
    }

    const codeHash = hashCode(recovery_code);
    const subRes = await supabaseFetch(`subscriptions?recovery_code_hash=eq.${codeHash}&select=*`);
    const subs = await subRes.json();
    const match = Array.isArray(subs)
      ? subs.find((s) => s.status === 'active' && s.expires_at && new Date(s.expires_at).getTime() > now)
      : null;

    await supabaseFetch('recovery_attempts?on_conflict=anon_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ anon_id, attempts: attempts + 1, window_start: new Date(windowStart).toISOString() }),
    });

    if (!match) {
      res.status(400).json({ error: 'Invalid or expired recovery code.' });
      return;
    }

    await supabaseFetch(`subscriptions?id=eq.${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ anon_id }),
    });

    res.status(200).json({ success: true, expiresAt: match.expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Could not process recovery right now.' });
  }
};
