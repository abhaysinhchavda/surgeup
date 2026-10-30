# SurgeAPI — design

**Status:** draft for approval · **Date:** 2026-10-30 · **Event:** TUM Blockchain & AI Hackathon, BSV Association track (€2,500 / €1,000 / €500)
**Builder:** one developer, ~16 hours total including demo video and submission.

## 1. Intent and why

AI APIs sell priority as fixed monthly tiers. When an API is congested, an urgent request waits behind cheap ones, and the provider can't price the scarce moment. SurgeAPI is a pay-per-call AI API on BSV with a **live priority market**: every call pays a published surge price in sats, callers can bid above it, and the server always serves the highest bid next. Queue depth moves the price. AI agents pay for themselves from their own wallets — no accounts, no API keys, no custodian.

Why BSV: per-call payments of a few hundred sats are only practical where fees are tiny and settlement is instant; the BSV stack already ships HTTP 402 payment middleware.

## 2. Goals

1. A working 402-paid API where price = `max(surgePrice, callerBid)` and paid jobs are served highest-bid-first.
2. A surge price that rises and falls with queue depth, published at a free endpoint.
3. Two or three autonomous demo agents (different urgency) that read the price, decide a bid, and pay from their own wallets. **This is the "AI agent makes a payment" requirement.**
4. A human flow through **BSV Desktop via WalletClient (BRC-100)**: a web dashboard where a person submits a job and pays with their wallet. **Required by the track rules.**
5. A live dashboard: current price, queue (by bid), served jobs with WhatsOnChain links.
6. Real mainnet transactions, linkable on WhatsOnChain, for the submission.

## 3. Non-goals (cut on purpose)

- A real order book, partial fills, or a matching engine.
- Refunds. Avoided by design: the minimum bid is the current surge price and the queue has no expiry, so **every paid job is eventually served**; priority only changes order.
- Multiple providers, provider discovery, or an overlay service.
- Accounts, logins, a database beyond in-memory state.
- Mobile app (BSV Browser works for the web page only if it happens to).
- A real AI model in the first version (see §6).

**Stretch only if core is done by hour 11:** a BSV-21 "priority pass" token the server mints to a caller, which grants front-of-queue once and can be transferred/resold to another agent. This is the DeFi talking point; the starter kit already has BSV-21 mint/transfer code.

## 4. Anti-goals (failure even if it "works")

- Any server-held user funds or keys. Payments go caller wallet → provider wallet directly (BRC-29 via the 402 middleware).
- Keys or recovery phrases in chat, prompts, or Git. Agent and provider keys live only in a gitignored `.env`.
- A demo that only runs on the mock chain. The submission must show real transactions.
- Charging someone who then never gets served.

## 5. Constraints

- **Stack (track rules):** `@bsv/sdk`, `@bsv/wallet-toolbox`, and the starter kit's 402 middleware. TypeScript, Node 22+.
- **Start from** the starter kit `starter/bsv21-token-kit` (38 passing tests). Its `examples/payPerRequest.ts` already has:
  - BRC-105 (`@bsv/auth-express-middleware` + `@bsv/payment-express-middleware`) with `calculateRequestPrice: req => ...` — a per-request price callback. **This is where surge pricing plugs in.**
  - BRC-121 (`@bsv/402-pay`) as a simpler, unauthenticated alternative.
  - `withHostOriginator` workaround for the wallet-toolbox originator bug — reuse it.
  - Mock-chain e2e tests (`test/pay-per-request.e2e.test.ts`) to copy for our tests.
- **Network:** mainnet (BSV Association funds teams on mainnet; ask @lexamaison on Telegram — the user does this, not the builder). Broadcast via Arcade as the kit does.
- **Submission:** public repo + README, 2–3 min demo video, WhatsOnChain tx links, one-page usage/value note.
- **Judging weights:** adoption 35%, stack use 25%, technical/non-custodial 20%, agentic payments 10%, originality/presentation 10%.

## 6. Decisions made

| Decision | Choice | Whose call |
|---|---|---|
| Idea | SurgeAPI over Underwrite (solo, 16 h) | User |
| AI backend | **Mock**: returns a canned "AI result" after a fixed service time (~2 s), so the queue visibly builds. One function `runJob()` to swap for a real model later; key would go in `.env` | Claude's call |
| Payment protocol | **BRC-105** (authenticated): the server knows each caller's identity key, so the dashboard can label "Agent A / Agent B / You". BRC-121 is the fallback if auth gets in the way | Claude's call |
| How a bid is sent | JSON body field `bid` (sats), required — not a custom header, per AGENTS.md "do not invent headers"; `express.json()` runs before the payment middleware so `calculateRequestPrice` can read `req.body.bid`. **The price charged is the bid itself**, so it can't drift between the 402 challenge and the paid retry. The floor check (`bid >= surgePrice`) runs only on the unpaid first request: a too-low bid gets `400 { priceSats }` *before* any payment. The paid retry (carries `x-bsv-payment`) is accepted at its bid even if the surge moved meanwhile | Claude's call (from builder check) |
| Serving | Single worker, concurrency 1. **`POST /job` returns at once** with `{ jobId, paidSats, position }` after payment; the client polls `GET /job/:id` until `done`. No held-open responses, so a client disconnect never loses a paid job. Queue sorted by paid sats desc, then arrival | Claude's call (from builder check) |
| Known limit | Restarting the server drops queued paid jobs (in-memory). Accepted for the demo; stated in the README | Claude's call |
| Wallet setup (mainnet) | `Setup.createWalletSQLite({ env, rootKeyHex, filePath, databaseName })` with a hand-built `env` (guide §14, per AGENTS.md), SQLite files in gitignored `.local/` (survive restarts), broadcasting via Arcade. Provider + 3 agents. User funds each agent from BSV Desktop (~10,000 sats each is plenty at ~100–500 sats per call) | Claude's call |
| Txid for links | Taken from the payment: decode the BRC-29 transaction in the `x-bsv-payment` header (or `req.payment` if it carries one) and store its txid with the job | Claude's call |
| Dashboard hosting | Served by the same Express server (same origin), so no CORS setup for `AuthFetch` / custom headers | Claude's call |
| Surge price formula | `price = base × (1 + k × queueDepth)`, e.g. base 100 sats, k 0.5. Recomputed on every enqueue/dequeue. Published at free `GET /price` | Claude's call; constants tunable |
| Agent wallets | Server-side wallet-toolbox wallets, one key per agent in `.env`, funded by the user from BSV Desktop | Claude's call |
| Provider wallet | Server-side wallet-toolbox wallet (key in `.env`) receives payments | Claude's call |
| Human flow | Web page uses `WalletClient` (BSV Desktop) + `AuthFetch` to pay and submit a job | Required by rules |
| Storage | In-memory queue and served-jobs log; restart clears it | Claude's call |
| Project location | Build in `D:\Cluade_WS\TUM_SurgeAPI` (user-provided; identical copy of the developer pack, `AGENTS.md` already at root). `git init` there before building; follow its `AGENTS.md` rules | User folder, Claude's call on layout |

## 7. Architecture and data flow

```
 Agents (own wallets) ──GET /price──► Price engine (queue depth → price)
        │                                   ▲
        │ POST /job  x-surge-bid            │ depth changes
        ▼                                   │
 Auth middleware (BRC-103/104: who)         │
        ▼                                   │
 Payment middleware (BRC-105) ──402 challenge, price = max(surge, bid)
        │  caller wallet pays (BRC-29 tx, broadcast via Arcade)
        ▼                                   │
 Priority queue (paid sats desc) ───────────┘
        ▼
 Worker → runJob() (mock AI, ~2 s) → response: result + receipt/txid
        ▼
 Dashboard (GET /state, polled): price, queue, served jobs + WhatsOnChain links
```

Endpoints:
- `GET /price` (free) → `{ priceSats, queueDepth }`
- `POST /job` (paid, BRC-105) body `{ prompt, bid }` → `{ jobId, paidSats, txid, position }`
- `GET /job/:id` (free) → `{ status: queued|running|done, position, result?, waitedMs? }`
- `GET /state` (free) → queue snapshot + last N served jobs (caller label, paid sats, txid, wait time)

Demo agents (one script, run N copies with different configs):
- `urgency` ∈ {low, medium, high}; bid rule e.g. low = pay surge price, medium = surge × 1.5, high = surge × 3.
- Loop: read `/price`, compute bid, `POST /job` via `AuthFetch(wallet)`, log result and txid, sleep, repeat.
- A "burst" mode sends several jobs at once so the queue and price visibly spike.

## 8. Success looks like (demo, 2–3 min)

1. Quiet API: price at base, one job served instantly.
2. Start the burst: low/medium agents flood in, queue grows, price climbs on the dashboard.
3. The high-urgency agent arrives late, outbids everyone, and is served next.
4. A human submits a job from the dashboard and pays with BSV Desktop.
5. Click a served job → its transaction on WhatsOnChain.
6. (Stretch) one agent hands its priority pass to another.

## 9. Testing

- Unit: price formula; queue ordering (bid desc, then FIFO).
- E2E on the kit's mock chain: a paid `/job` returns a result; a higher bid submitted later is served before a lower one already waiting; payment equals `max(surge, bid)`.
- Manual on mainnet: each flow once with tiny amounts before recording.

## 10. Time budget (16 h)

| Hours | Work |
|---|---|
| 0–1 | `git init`, copy the starter kit, `npm install`, `npm test` green; user requests mainnet sats |
| 1–5 | Server: price engine, queue, worker, `/price` `/job` `/state`, mock-chain e2e tests |
| 5–8 | Agent script + wallet setup, fund agents, first real mainnet run |
| 8–11 | Dashboard: live state, human pay flow via BSV Desktop |
| 11–13 | Stretch (priority pass) **or** polish and bug fixes |
| 13–14.5 | README, one-page value note, collect WhatsOnChain links |
| 14.5–16 | Record and edit the demo video, submit |

## 11. Left to the builder

- Exact price constants and agent bid multipliers (tune so the demo looks good in ~60 s).
- Dashboard look (plain, readable; Vite like the kit's `web/`).
- Polling interval for `/state` (1 s is fine).
- **First hour spike:** confirm on the mock chain that a per-request price taken from `req.body.bid` round-trips through the BRC-105 challenge and paid retry. If not, switch to BRC-121 (`@bsv/402-pay`) with the same bid-as-price rule.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Middleware rejects a header-driven price | Hour-1 spike; fall back to BRC-121 |
| Mainnet sats arrive late | Build and test everything on the mock chain first |
| "Is this DeFi?" | Pitch it as a live market for API capacity; the priority-pass stretch adds a tradable asset |
| Running out of time | Priority pass is the first thing cut; the video is never cut |
