const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, avoids confusion
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
  const { reference } = req.query || {};

  if (!reference) {
    res.writeHead(302, { Location: '/?payment=failed' });
    res.end();
    return;
  }

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const data = await verifyRes.json();
    const success = data.status && data.data && data.data.status === 'success';

    if (!success) {
      res.writeHead(302, { Location: '/?payment=failed' });
      res.end();
      return;
    }

    const anonId = data.data.metadata && data.data.metadata.anon_id ? data.data.metadata.anon_id : null;
    const email = data.data.customer && data.data.customer.email;
    const expiresAtMs = Date.now() + THIRTY_DAYS_MS;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    let recoveryCode = null;
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && anonId) {
      try {
        recoveryCode = generateRecoveryCode();
        const codeHash = hashCode(recoveryCode);
        await supabaseFetch('subscriptions?on_conflict=anon_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            anon_id: anonId,
            recovery_code_hash: codeHash,
            plan: 'pro',
            status: 'active',
            payment_reference: reference,
            provider: 'paystack',
            started_at: new Date().toISOString(),
            expires_at: expiresAtIso,
          }),
        });
      } catch (dbErr) {
        recoveryCode = null; // fall back to the client-side token below
      }
    }

    // Fallback token so the site still works even before Supabase is fully set up
    const fallbackToken = Buffer.from(JSON.stringify({ email, expiresAt: expiresAtMs })).toString('base64');

    const params = new URLSearchParams({ pro_activated: '1', expires_at: expiresAtIso, premium_token: fallbackToken });
    if (recoveryCode) params.set('recovery_code', recoveryCode);

    res.writeHead(302, { Location: `/?${params.toString()}` });
    res.end();
  } catch (err) {
    res.writeHead(302, { Location: '/?payment=error' });
    res.end();
  }
};

