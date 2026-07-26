const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FREE_DAILY_QUESTION_LIMIT = 5;

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { anon_id } = req.body || {};
    if (!anon_id) {
      res.status(400).json({ error: 'Missing anon_id' });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      res.status(200).json({ isPro: false, expiresAt: null, questionsUsedToday: 0, dailyLimit: FREE_DAILY_QUESTION_LIMIT, backendReady: false });
      return;
    }

    const subRes = await supabaseFetch(`subscriptions?anon_id=eq.${encodeURIComponent(anon_id)}&select=status,expires_at`);
    const subs = await subRes.json();
    const now = Date.now();
    let isPro = false;
    let expiresAt = null;
    if (Array.isArray(subs) && subs.length > 0) {
      const sub = subs[0];
      if (sub.status === 'active' && sub.expires_at && new Date(sub.expires_at).getTime() > now) {
        isPro = true;
        expiresAt = sub.expires_at;
      }
    }

    const today = lagosDateKey(new Date());
    const usageRes = await supabaseFetch(`usage_daily?anon_id=eq.${encodeURIComponent(anon_id)}&usage_date=eq.${today}&select=question_count`);
    const usageRows = await usageRes.json();
    const questionsUsedToday = Array.isArray(usageRows) && usageRows.length > 0 ? usageRows[0].question_count : 0;

    res.status(200).json({ isPro, expiresAt, questionsUsedToday, dailyLimit: FREE_DAILY_QUESTION_LIMIT, backendReady: true });
  } catch (err) {
    res.status(200).json({ isPro: false, expiresAt: null, questionsUsedToday: 0, dailyLimit: FREE_DAILY_QUESTION_LIMIT, backendReady: false });
  }
};
