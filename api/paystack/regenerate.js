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

  const { reference, anon_id } = req.body || {};
  if (!reference || !anon_id) {
    res.status(400).json({ error: 'Enter the payment reference from your Paystack receipt.' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !process.env.PAYSTACK_SECRET_KEY) {
    res.status(500).json({ error: 'Recovery is not fully configured yet.' });
    return;
  }

  // Step 1: verify the reference directly with Paystack.
  let verifyData;
  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference.trim())}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    verifyData = await verifyRes.json();
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Paystack to verify that payment. Try again in a moment.' });
    return;
  }
  const success = verifyData && verifyData.status && verifyData.data && verifyData.data.status === 'success';
  if (!success) {
    res.status(400).json({ error: 'That payment reference could not be verified. Double check it matches your receipt exactly.' });
    return;
  }

  // Step 2: find the subscription tied to that reference.
  let sub;
  try {
    const subRes = await supabaseFetch(`subscriptions?payment_reference=eq.${encodeURIComponent(reference.trim())}&select=*`);
    const subs = await subRes.json();
    sub = Array.isArray(subs) && subs.length > 0 ? subs[0] : null;
  } catch (err) {
    res.status(502).json({ error: 'Could not check our records right now. Try again in a moment.' });
    return;
  }
  if (!sub) {
    res.status(400).json({ error: 'That payment was verified, but no SABIBOOK subscription is linked to it yet. Contact support with your reference.' });
    return;
  }
  if (!(sub.expires_at && new Date(sub.expires_at).getTime() > Date.now())) {
    res.status(400).json({ error: 'That subscription has already expired.' });
    return;
  }

  // Step 3: generate a fresh code and link this device, without breaking on a duplicate anon_id.
  const newCode = generateRecoveryCode();
  const newHash = hashCode(newCode);
  try {
    if (sub.anon_id && sub.anon_id !== anon_id) {
      // Free up the new anon_id first, in case this device already has an old/unrelated row.
      await supabaseFetch(`subscriptions?anon_id=eq.${encodeURIComponent(anon_id)}&id=neq.${sub.id}`, { method: 'DELETE' });
    }
    const patchRes = await supabaseFetch(`subscriptions?id=eq.${sub.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ recovery_code_hash: newHash, anon_id }),
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.text();
      res.status(502).json({ error: 'Could not save your new code (' + patchRes.status + '). Try again.' });
      return;
    }
  } catch (err) {
    res.status(502).json({ error: 'Could not save your new code right now. Try again.' });
    return;
  }

  res.status(200).json({ recoveryCode: newCode, expiresAt: sub.expires_at });
};
