const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

    const email = data.data.customer && data.data.customer.email;
    const expiresAt = Date.now() + THIRTY_DAYS_MS;
    const token = Buffer.from(JSON.stringify({ email, expiresAt })).toString('base64');

    res.writeHead(302, { Location: `/?premium_token=${token}` });
    res.end();
  } catch (err) {
    res.writeHead(302, { Location: '/?payment=error' });
    res.end();
  }
};
