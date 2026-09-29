const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if ((i + 1) % 4 === 0 && i !== 11) code += '-';
  }
  return 'SABI-' + code;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
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
    const { reference, anon_id } = req.body || {};
    if (!reference || !anon_id) {
      res.status(400).json({ error: 'Enter the payment reference from your Paystack receipt.' });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      res.status(500).json({ error: 'Recovery is not available yet.' });
      return;
    }

    // Re-verify the reference directly with Paystack, so only a real, successful payment can regenerate a code.
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference.trim())}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();
    const success = verifyData.status && verifyData.data && verifyData.data.status === 'success';
    if (!success) {
      res.status(400).json({ error: 'That payment reference could not be verified.' });
      return;
    }

    const subRes = await supabaseFetch(`subscriptions?payment_reference=eq.${encodeURIComponent(reference.trim())}&select=*`);
    const subs = await subRes.json();
    const sub = Array.isArray(subs) && subs.length > 0 ? subs[0] : null;
    if (!sub) {
      res.status(400).json({ error: 'No subscription found for that reference.' });
      return;
    }
    if (!(sub.expires_at && new Date(sub.expires_at).getTime() > Date.now())) {
      res.status(400).json({ error: 'That subscription has already expired.' });
      return;
    }

    const newCode = generateRecoveryCode();
    const newHash = hashCode(newCode);

    await supabaseFetch(`subscriptions?id=eq.${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ recovery_code_hash: newHash, anon_id }),
    });

    res.status(200).json({ recoveryCode: newCode, expiresAt: sub.expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Could not regenerate a code right now.' });
  }
};
