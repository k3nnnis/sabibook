# SABIBOOK — deployment guide

Everything here can be done from your phone's browser. No laptop, no command line.

## What's in this project
- `index.html` — the whole app (camera capture, answer display, ad break, premium modal). No build step.
- `api/solve.js` — calls Claude to solve the captured question. Keeps your Anthropic key private on the server.
- `api/paystack/initialize.js` — starts a Paystack checkout for the ₦500/month plan.
- `api/paystack/callback.js` — runs after payment, verifies it with Paystack, marks the browser as premium.

## Step 1 — Put this project on GitHub
1. Go to github.com on your phone, log in.
2. Create a new repository (e.g. `sabibook`). Keep it Private if you'd rather not show the code publicly — that's fine, it doesn't affect deployment.
3. Open the new repo → **Add file → Upload files**.
4. Upload all the files in this project, keeping the `api` and `api/paystack` folders intact (GitHub's uploader preserves folder structure if you drag the whole folder, or you can upload the two `api` files into an `api` folder you create in the web UI first).
5. Commit.

## Step 2 — Create a Vercel account and import the repo
1. Go to vercel.com → **Sign Up** → choose **Continue with GitHub** (one tap, no new password needed).
2. Once logged in, tap **Add New → Project**.
3. Select your `sabibook` repo → **Import**.
4. Framework Preset: choose **Other** (this is a static site with API functions, no build step needed).
5. Don't deploy yet — first add the environment variables below, then deploy.

## Step 3 — Add your two secret keys
Still in the import screen (or afterwards in **Project → Settings → Environment Variables**), add:

| Name | Value | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | starts with `sk-ant-...` | console.anthropic.com → this is separate from your Claude.ai app login. Sign in, add a payment method under **Billing**, then create a key under **API Keys**. This is what actually pays for each solved question — usage-based, roughly 1-2 US cents per question. |
| `PAYSTACK_SECRET_KEY` | starts with `sk_test_...` (start in test mode) | Your Paystack dashboard → Settings → API Keys & Webhooks. Use the **test** secret key first so you can try a full payment without moving real money, then switch to the **live** key once you've tested it end to end. |

Never put these in the HTML or in GitHub — only in Vercel's Environment Variables screen, which keeps them encrypted and server-side only.

## Step 4 — Deploy
Tap **Deploy**. Vercel gives you a live link like `sabibook.vercel.app` — that's your real, working site.

If you added the environment variables *after* the first deploy, go to **Deployments → ⋯ → Redeploy** so the new variables take effect.

## Step 5 — Test before going live with real money
1. Open your `sabibook.vercel.app` link on your phone.
2. Snap a question — you should get a real AI answer.
3. Tap **Go ad-free**, enter an email, tap **Pay with Paystack** — since you're on the *test* key, use one of Paystack's test cards (listed on their docs) to complete a fake payment and confirm you land back on the site marked Premium.
4. Once that works end to end, swap `PAYSTACK_SECRET_KEY` in Vercel to your **live** `sk_live_...` key and redeploy. Real payments will now work.

## Optional next steps
- **Custom domain**: buy a domain (e.g. from Namecheap) and connect it under Vercel → Project → Settings → Domains, instead of the `.vercel.app` address.
- **Cheaper AI cost**: if margins get tight, `api/solve.js` can be switched from `claude-sonnet-5` to `claude-haiku-4-5-20251001`, which costs less per question — worth testing accuracy on your actual questions first.
- **Stronger premium tracking**: right now "premium" is remembered as a signed-looking token in the browser's local storage, not a database — simple and free, but a technically savvy user could fake it locally. Fine for a v1; if you later want it airtight, that's where a small database (e.g. Vercel KV or Postgres) would come in.
- 
