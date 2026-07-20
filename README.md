# Patrimoine — financial dashboard

A plain Vite + React app (no build-tool magic beyond that) with a single Vercel
serverless function (`api/chat.js`) that holds the Anthropic API key and proxies
the "Conseiller IA" chat requests, so the key never reaches the browser.

## Local development

Requires Node.js (18+) and the Vercel CLI for testing the API route locally.

```bash
npm install
npm i -g vercel        # one-time, if you don't already have it
vercel dev             # serves both the Vite frontend and api/chat.js locally
```

`npm run dev` alone will run the frontend but `/api/chat` calls will 404 —
`vercel dev` is what wires up the serverless function locally.

Create a `.env` file (copy `.env.example`) with your key before running `vercel dev`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Deploying

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com/new and import the repo. Vercel auto-detects Vite;
   no build config needed.
3. In the project's **Settings → Environment Variables**, add `ANTHROPIC_API_KEY`
   (Production and Preview) with your key. Never commit it — `.env` is gitignored.
4. Deploy. Vercel builds the frontend and picks up `api/chat.js` as a serverless
   function automatically at `/api/chat`.

## What changed from the original artifact version

- `window.storage` (only available inside the Claude.ai Artifacts host) is
  replaced by `src/storage.js`, a thin wrapper over `localStorage` with the
  same `{ get, set }` shape. **This means data is per-browser, not synced
  across devices** — if you open the dashboard on your phone, it starts empty.
  If you want cross-device sync later, that needs real backend storage
  (a database behind another small API route), which is a bigger step than
  this one.
- The chat's two Anthropic calls (draft, then self-critique) now go through
  `/api/chat` instead of `https://api.anthropic.com` directly, so the API key
  stays server-side.

## One thing worth knowing

`/api/chat` isn't authenticated — anyone who has the deployed URL can call it
and consume your Anthropic budget. Fine for casual personal/family use with an
unlisted URL, but if that ever becomes a concern, the simplest fix is Vercel's
built-in deployment protection (password-gate the whole site), or basic rate
limiting in `api/chat.js`.
