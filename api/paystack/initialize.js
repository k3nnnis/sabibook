const PREMIUM_AMOUNT_KOBO = 75000; // ₦750

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, anon_id } = req.body || {};
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'A valid email is required' });
      return;
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      res.status(500).json({ error: 'Server is not configured with a Paystack key yet' });
      return;
    }

    const origin = `https://${req.headers.host}`;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: PREMIUM_AMOUNT_KOBO,
        callback_url: `${origin}/api/paystack/callback`,
        metadata: { anon_id: anon_id || '' },
      }),
    });

    const data = await paystackRes.json();

    if (!data.status) {
      res.status(400).json({ error: data.message || 'Could not start payment' });
      return;
    }

    res.status(200).json({ authorization_url: data.data.authorization_url });
  } catch (err) {
    res.status(500).json({ error: 'Server error starting payment' });
  }
};
