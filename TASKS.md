# SurgeAPI A+ — Team Task File

> **One file, whole project.** Supersedes `docs/superpowers/plans/2026-10-30-surgeapi.md` and the solo design. Team of 3, 16 hours, TUM Blockchain & AI Hackathon — BSV Association track. Binding rules: `AGENTS.md` (repo root). Reference code: `starter/bsv21-token-kit/` (do not edit it).
>
> Each task: tick `- [ ]` boxes as you go, write the test first where one is given, commit at the end of each task.

## 1. What we are building

A pay-per-call AI API on BSV **mainnet** with a **live priority market**:

- Every call pays a **surge price** in sats that rises with queue depth; callers may **bid above it**; the server serves the **highest-paid job next**.
- **Priority pass (BSV-21 token):** buy one for a fixed price; spend it later to jump to the front of the queue; **resell** it to another agent.
- **Agents pay for themselves:** scripted bidding agents (urgency rules) and one **LLM agent** (Claude with tool calls) that decides whether and how much to bid within a sats budget.
- **A human pays from BSV Desktop** (WalletClient, BRC-100) on a live dashboard.
- Non-custodial: every payment goes from the payer's own wallet straight to the provider (BRC-29 inside BRC-105). No server holds anyone else's funds.

**Judging fit:** adoption 35% (API providers + agent builders; pass resale = a small secondary market), stack 25% (BRC-100, 103/104, 105, 29, BSV-21, overlay, wallet-toolbox, Arcade), technical/non-custodial 20%, agentic payments 10% (scripted + LLM agents), originality 10% (no live API priority auction exists).

**Out of scope:** real order book, refunds, multiple providers, accounts/DB, mobile app, real AI model (mock `runJob`), cross-chain swaps, atomic OrdLock resale (resale is pay-then-transfer; README says so).

## 2. Team

| Person | Owns | Tasks |
|---|---|---|
| **P1 — Backend & payments** | Repo, spike, market, server, wallets, funding | T1–T4 |
| **P2 — Agents** | Scripted agents + burst demo, LLM agent | T5–T6 |
| **P3 — Front end, pass, story** | Dashboard + human pay, priority pass, README/value note, video | T7–T9 |

P2 and P3 start immediately against the **contract in §4**, using the mock chain or a stub until P1's server lands (T3, ~hour 5).

## 3. Global constraints (every task)

- Package versions exactly as the kit's `package.json` + lockfile. Only new dependency: `@anthropic-ai/sdk` (T6).
- **Ports:** SurgeAPI server **3000**, token overlay **8080** (kit default), dashboard **5173**.
- **Pricing:** `baseSats = 100`, `k = 0.5`, `price = ceil(baseSats × (1 + k × queuedCount))`. Pass price `PASS_SATS = 500`. Mock service time 2000 ms (tests use small values).
- **Charged price = the caller's `bid`** (positive integer, JSON number, in the body). Unpaid first request with `bid < price()` → `400 { error: 'bid below surge price', priceSats }` before any payment. Paid retry (has `x-bsv-payment` header) only needs `bid >= baseSats`. Queue priority uses `req.payment.satoshisPaid`, never the body.
- No custom headers (AGENTS.md). Bid and label travel in the JSON body.
- **Secrets:** private keys and `ANTHROPIC_API_KEY` only in gitignored `.env`; wallet SQLite files in gitignored `.local/`. Never print, log, or commit a key. Never ask anyone for a recovery phrase.
- **Money moves only with a human OK:** funding, demo runs, pass deploy, and every mainnet spend are run by a team member who approves it (BSV Desktop prompt, or explicit go for agent wallets).
- Explorer links: `https://whatsonchain.com/tx/<txid>`; tokens: `https://bananablocks.com`.
- Tests on the kit's mock chain (`test/helpers/mockchain.ts`); single `@bsv/sdk` build via `vitest.config.ts` alias.

## 4. Shared contract (agree in the first 15 minutes, then don't change without telling the team)

**HTTP API (server on :3000)**

| Route | Auth/pay | Request | Response |
|---|---|---|---|
| `GET /price` | free | — | `{ priceSats, queueDepth, passSats }` |
| `GET /state` | free | — | `MarketSnapshot` (below) |
| `GET /job/:id` | free | — | `{ id, status, position, result, waitedMs, paidSats, txid, label, viaPass }` or `404 { error: 'not found' }` |
| `POST /job` | BRC-105, price = `bid` | `{ prompt, bid, label? }` | `{ jobId, paidSats, txid, position }` |
| `POST /pass` | BRC-105, price = `PASS_SATS` | `{}` | `{ passTxid }` (1 pass token sent to the caller) |
| `POST /job/pass` | BRC-103/104 auth, price 0 | `{ prompt, passTxid, label? }` — `passTxid` = the caller's tx that sent 1 pass to the provider | `{ jobId, position: 1 }` or `400 { error: 'invalid pass' }` |

Errors before payment: `400 { error: 'bad prompt' }` (empty / > 2000 chars / missing), `400 { error: 'bad bid' }`, `400 { error: 'bid below surge price', priceSats }`.

**Types (`src/market.ts`)**

```ts
export interface MarketConfig { baseSats: number, k: number }
export type JobStatus = 'queued' | 'running' | 'done'
export interface Job { id: string, caller: string, label: string, prompt: string, paidSats: number, txid: string, viaPass: boolean, seq: number, enqueuedAt: number, status: JobStatus, startedAt?: number, doneAt?: number, result?: string }
export interface MarketSnapshot { priceSats: number, queueDepth: number, queue: Job[], running?: Job, served: Job[] }
```

**Pass service (`src/pass.ts`, P3 implements; P1 wires it with a fake in tests)**

```ts
export interface PassService {
  issue (toIdentityKey: string): Promise<{ txid: string }>               // send 1 pass to the buyer
  redeem (passTxid: string, fromIdentityKey: string): Promise<boolean>   // true once per valid pass received by the provider
}
```

## 5. Timeline

| Hours | P1 | P2 | P3 |
|---|---|---|---|
| 0–0.5 | **All:** agree §4; request mainnet sats from @lexamaison (send a BSV Desktop address + team name); set up BSV Desktop; one person adds `ANTHROPIC_API_KEY` to their own `.env` | | |
| 0.5–1.5 | T1 scaffold + spike | T5 `bidFor` + test | T7 dashboard against a stubbed `/state` |
| 1.5–5 | T2 market, T3 server | T6 LLM agent against the mock chain | T8 pass: overlay up, token deploy script, `PassService` |
| 5–8 | T4 mainnet wallets + funding | T5 agents on mainnet, burst demo | T7 human pay flow; T8 issue/redeem on mainnet |
| 8–11 | Integration + bug fixes | T6 LLM agent on mainnet | T8 resale script |
| 11–13 | **Freeze features.** End-to-end rehearsal of the demo script (§7) on mainnet; collect WhatsOnChain links | | |
| 13–14.5 | Help P3 | Help P3 | T9 README + VALUE.md |
| 14.5–16 | **All:** record + edit video, push public repo, submit | | |

**Cut order if late:** resale script → LLM agent on mainnet (keep the mock-chain run in the video) → pass entirely. The core (T1–T5, T7) and the video are never cut.

---

## P1 — Backend & payments

### T1: Scaffold + pricing spike

**Files:** create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/payments.ts`, `test/helpers/mockchain.ts`, `test/spike.e2e.test.ts`; copy kit `client/`, `core/`, `overlay/` to `src/kit/`; delete `.DS_Store` files.

- [ ] Copy from `starter/bsv21-token-kit/`: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `test/helpers/mockchain.ts`; `client/payments.ts` → `src/payments.ts`; `client/`, `core/`, `overlay/` → `src/kit/` unchanged (T8 needs `TokenKit`, `OverlayClient` and the overlay server). Fix relative imports in `src/kit/` and the mock-chain helper if paths break.
- [ ] `package.json`: name `surgeapi`; scripts `server: tsx --env-file=.env src/main.ts`, `overlay: tsx src/kit/overlay/server.ts`, `agent: tsx --env-file=.env src/agent.ts`, `llm-agent: tsx --env-file=.env src/llmAgent.ts`, `demo: tsx --env-file=.env scripts/demo.ts`, `keygen: tsx scripts/keygen.ts`, `fund: tsx --env-file=.env scripts/fund.ts`, `deploy-pass: tsx --env-file=.env scripts/deployPass.ts`, `resell: tsx --env-file=.env scripts/resell.ts`, `web: vite web`, `test: vitest run`, `typecheck: tsc --noEmit`.
- [ ] `tsconfig.json` `include` → `["src", "scripts", "web"]` (tests stay out of `tsc`, as in the kit: the mock-chain helper mixes the SDK's CJS and ESM types; vitest's alias handles it at runtime).
- [ ] **Windows install note:** use Node 24's own npm (`node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install`). An old global npm 8 skips the `better-sqlite3` prebuilt binary and fails compiling it (ClangCL missing).
- [ ] `.gitignore`: `node_modules`, `.env`, `.local/`, `data/*.db*`, `dist`, `.DS_Store`. `.env.example`: `PROVIDER_KEY=`, `AGENT_A_KEY=`, `AGENT_B_KEY=`, `AGENT_C_KEY=`, `AGENT_LLM_KEY=`, `ANTHROPIC_API_KEY=`, `PASS_TOKEN_ID=`, `SURGE_URL=http://localhost:3000`, `OVERLAY_URL=http://localhost:8080`.
- [ ] `git init`, `npm install`, `npm run typecheck` → passes.
- [ ] **Spike test `body bid sets the charged price`:** inline app — `express.json()`, `createAuthMiddleware({ wallet: merchant })`, `createPaymentMiddleware({ wallet: merchant, calculateRequestPrice: req => req.method === 'POST' && req.path === '/job' ? Number(req.body?.bid ?? 0) : 0 })`, `POST /job` returns `{ receipt: req.payment, body: req.body }`, port 18099. `new AuthFetch(alice).fetch(url + '/job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hi', bid: 333 }) })` → expect status 200, `receipt` matches `{ accepted: true, satoshisPaid: 333 }`, `receipt.txid` matches `/^[0-9a-f]{64}$/`, `body.bid === 333`, merchant balance +333. Copy `spendableSats`/`listen` helpers from the kit's `test/pay-per-request.e2e.test.ts`.
- [ ] Run → PASS. **If it fails:** tell the team now. Fallback = BRC-121 (`@bsv/402-pay`, `calculatePrice`), same bid-as-price rule; clients become `create402Fetch({ wallet: withHostOriginator(wallet) })`.
- [ ] Commit `chore: scaffold + pricing spike`.

### T2: Market

**Files:** `src/market.ts`, `test/market.test.ts`

```ts
export class Market {
  readonly cfg: MarketConfig
  constructor (cfg: MarketConfig, now?: () => number)
  price (): number
  enqueue (j: { caller: string, label: string, prompt: string, paidSats: number, txid: string, viaPass?: boolean }): Job
  next (): Job | undefined        // viaPass first, then paidSats desc, then seq asc; marks running, sets startedAt
  complete (id: string, result: string): void
  get (id: string): Job | undefined
  position (id: string): number | undefined   // 1-based among queued, serve order
  snapshot (): MarketSnapshot     // queue in serve order; served = done, newest first, max 20
}
```

- [ ] Tests (`{ baseSats: 100, k: 0.5 }`): `price rises with queue depth` (0→100, 1→150, 2→200, after `next()` →150); `serves highest paid first, FIFO on ties` (paid 100 a, 300 b, 200 c, 300 d → b, d, c, a); `pass jobs jump the queue` (paid 900 a, then viaPass b paid 0 → b, a); `position is 1-based in serve order`; `snapshot lists served newest first, capped at 20`.
- [ ] FAIL → implement (plain arrays; `// ponytail: O(n log n) per dequeue, heap if the queue passes ~10k`) → PASS → commit `feat: market`.

### T3: Server + worker

**Files:** `src/server.ts`, `test/surge.e2e.test.ts`

```ts
export const MAX_PROMPT = 2000
export const PASS_SATS = 500
export function createSurgeApp (provider: WalletInterface, market: Market, passes?: PassService): Express
export function startWorker (market: Market, runJob: (prompt: string) => Promise<string>, idleMs?: number): { stop: () => void }
export function mockRunJob (serviceMs: number): (prompt: string) => Promise<string>   // sleeps, returns `[mock AI] ${prompt.slice(0, 60)}`
```

Middleware order: `express.json()` → free GET routes → `createAuthMiddleware({ wallet: provider })` → `POST /job` validation (prompt, bid, surge floor per §3) → `createPaymentMiddleware({ wallet: provider, calculateRequestPrice: req => req.method !== 'POST' ? 0 : req.path === '/job' ? req.body.bid : req.path === '/pass' ? PASS_SATS : 0 })` → paid/authed handlers. `/pass` and `/job/pass` return `501 { error: 'passes disabled' }` when `passes` is undefined. **Why auth comes before validation:** `AuthFetch` throws on any response not signed by the auth middleware, so a 400 sent before auth crashes the client instead of reaching it. Checks still run before payment, so nobody is charged for a refused request. (Done — see `src/server.ts`.) Label: `body.label` string sliced to 24, else first 8 chars of `req.auth.identityKey`. Worker: loop `next()` → `await runJob` → `complete`; idle wait `idleMs` (default 100).

- [ ] Tests (mock chain; provider, funded alice + bob; port 18100; fresh `Market` per test; worker `mockRunJob(50)` unless stated; `FakePasses` = `{ issue: async () => ({ txid: 'f'.repeat(64) }), redeem: async txid => txid === 'a'.repeat(64) }`):
  - `price endpoint starts at base` → `{ priceSats: 100, queueDepth: 0, passSats: 500 }`
  - `rejects a bid below surge without charging` → 400 `{ error: 'bid below surge price', priceSats: 100 }`, provider balance unchanged
  - `rejects malformed bids` (`'abc'`, `-5`, `150.5`, `'200'`, missing → 400 `bad bid`, no charge)
  - `rejects bad prompts` (`''`, `'a'.repeat(2001)`, missing → 400 `bad prompt`)
  - `charges the bid and returns a job` (bid 150 → 200, `paidSats 150`, 64-hex txid, provider +150, polled job ends `done` with result containing the prompt)
  - `higher later bid is served first` (worker stopped; alice 100 = A, bob 400 = B; `/state` queue `[B, A]`; start worker; `B.doneAt < A.doneAt`)
  - `paid retry is accepted after surge rises` (stub `handlePaymentAndRetry` on a probe `AuthFetch` to get the challenge for bid 100; enqueue 2 dummy jobs so price is 200; pay 100 by hand with `randomizeOutputs: false` and resend with `x-bsv-payment` → 200, `paidSats 100`)
  - `buying a pass charges PASS_SATS` (`POST /pass` → 200 `{ passTxid: 'f'×64 }`, provider +500)
  - `a valid pass jumps the queue; a bad one is refused` (queue a bid-900 job; `POST /job/pass` with `'a'×64` → `position 1`; with `'b'×64` → 400 `invalid pass`)
  - `unknown job is 404`
- [ ] FAIL → implement → `npm test` all PASS → commit `feat: surge API, worker, pass routes`.

### T4: Mainnet wallets, keys, entrypoint, funding

**Files:** `src/wallet.ts`, `src/main.ts`, `scripts/keygen.ts`, `scripts/fund.ts`

- `makeServerWallet (rootKeyHex: string, filePath: string): Promise<Wallet>` — `Setup.createWalletSQLite` on mainnet (guide §14.1; the §14.2 manual build hits the SDK ESM/CJS `CachedKeyDeriver` type clash), `void monitor.startTasks()`; creates `.local/`. Helpers: `walletFromEnv(envVar)` (validates 64-hex key), `walletFileFor(envVar)`, `spendableSats(wallet)`. Files: `.local/provider.sqlite`, `.local/agent-{a,b,c,llm}.sqlite`.
- `main.ts`: provider wallet from `PROVIDER_KEY`; `Market({ baseSats: 100, k: 0.5 })`; `createSurgeApp(provider, market, PASS_TOKEN_ID ? await createPassService(...) : undefined)` (T8); listen 3000; `startWorker(market, mockRunJob(2000))`; log provider **identity key** only.
- `keygen.ts`: append any missing `PROVIDER_KEY`, `AGENT_A_KEY`, `AGENT_B_KEY`, `AGENT_C_KEY`, `AGENT_LLM_KEY` = `PrivateKey.fromRandom().toHex()`; never overwrite; never print keys; print names + identity keys.
- `fund.ts [satsPerAgent=10000]`: `WalletClient('auto', 'surgeapi.local')`, `waitForAuthentication`; for A, B, C, LLM: `createBrc29Payment(desktop, agentIdentityKey, sats, 'Fund SurgeAPI agent', 'surgeapi.local')` → `acceptBrc29Payment(agentWallet, p)`; print name, WhatsOnChain link, balance.

- [x] Implement; `npm run typecheck` + `npm test` green.
- [x] `npm run keygen` → `.env` written; `git status` shows no `.env` / `.local/`.
- [ ] **Team OK + BSV Desktop approval:** `npm run fund -- 10000` → 4 links, each agent 10000 sats.
- [x] `npm run server`; `curl http://localhost:3000/price` → `{"priceSats":100,"queueDepth":0,"passSats":500}`.
- [ ] Commit `feat: mainnet wallets, keygen, funding`.

## P2 — Agents

### T5: Scripted bidding agents + burst demo

**Files:** `src/agent.ts`, `scripts/demo.ts`, `test/agent.test.ts`

```ts
export type Urgency = 'low' | 'medium' | 'high'
export function bidFor (urgency: Urgency, surgeSats: number): number   // low = surge, medium = ceil(1.5×), high = 3×
export async function submitJob (wallet: WalletInterface, baseUrl: string, prompt: string, bid: number, label: string): Promise<{ status: number, body: any }>
export async function runAgent (o: { name: string, urgency: Urgency, wallet: WalletInterface, baseUrl: string, jobs: number, gapMs: number }): Promise<void>
```

`submitJob` = `new AuthFetch(wallet)` POST `/job`. `runAgent`, `jobs` times: `GET /price` → `bidFor` → `submitJob(prompt \`${name} task ${i}\`, label \`Agent ${name} (${urgency})\`)` → on 400 `bid below surge price` retry once at `bidFor(urgency, body.priceSats)` → log name, paidSats, position, WhatsOnChain link → sleep `gapMs`. CLI `npm run agent -- A low 5` (key `AGENT_<NAME>_KEY`, wallet `.local/agent-<name>.sqlite`, `SURGE_URL`, gap 300). `demo.ts`: A low 6 jobs gap 200 and B medium 4 jobs gap 300 together; after 3000 ms, C high 1 job.

- [ ] Test `bidFor`: `('low',150)=150`, `('medium',150)=225`, `('high',150)=450`, `('medium',101)=152`. FAIL → implement → PASS.
- [ ] **Team OK (~11 calls, ~3–5k sats):** with the server up, `npm run demo` → `/state` price climbs above 100; C's job starts before older queued A/B jobs; all links open on WhatsOnChain.
- [ ] Commit `feat: bidding agents + burst demo`.

### T6: LLM agent (Claude tool calls)

> The pasted "bsv-mcp" is now `bsv-blockchain/bsv-ai-toolkit` (`@bsv/mcp`): docs and broadcast tools only, **no wallet/signing tools**, so it cannot make an agent pay. We give Claude our own three tools backed by the agent's own wallet.

**Files:** `src/llmAgent.ts`, `test/llmAgent.test.ts`

```ts
export interface Budget { limitSats: number, spentSats: number }
export function guardBid (budget: Budget, bid: number): { ok: true } | { ok: false, reason: string }   // reject if bid <= 0, not integer, or spent + bid > limit
export async function runLlmAgent (o: { wallet: WalletInterface, baseUrl: string, tasks: Array<{ prompt: string, deadlineSec: number, valueSats: number }>, budgetSats: number, model?: string }): Promise<void>
```

- Model default `claude-haiku-5-5`; key from `ANTHROPIC_API_KEY` (never logged). `@anthropic-ai/sdk` messages API with tools: `get_price {}` → `/price`; `submit_job { prompt, bid }` → `guardBid` then `submitJob` (T5), updates `spentSats` only on 200; `check_job { jobId }` → `/job/:id`. Loop until the model stops calling tools or 20 turns. System prompt (exact): *"You are a purchasing agent with a budget of {budgetSats} sats. For each task decide whether it is worth paying for now, given its value and deadline and the current surge price. Never bid more than a task's value. Bid higher only when the deadline is close. Use the tools; explain each decision in one sentence."* Print each model decision sentence and each payment link (these lines go in the video).
- CLI: `npm run llm-agent -- 2000` (budget) with three built-in tasks: `{ 'Summarise incident report', 30, 600 }`, `{ 'Translate product page', 600, 200 }`, `{ 'Classify 10 tickets', 120, 300 }`.

- [ ] Tests for `guardBid`: `{limit 1000, spent 900}` + bid 200 → not ok; bid 100 → ok; bid 0, -1, 1.5 → not ok.
- [ ] Mock-chain smoke run against a local `createSurgeApp` (a team member with the API key runs it; ~3 small Claude calls) → at least one job paid, budget never exceeded.
- [ ] **Team OK:** mainnet run `npm run llm-agent -- 2000` during a burst → decisions printed, payments on WhatsOnChain.
- [ ] Commit `feat: LLM purchasing agent with budget guard`.

## P3 — Front end, pass, story

### T7: Dashboard + human pay flow

**Files:** `web/index.html`, `web/main.ts`, `web/vite.config.ts`

- `vite.config.ts`: port 5173, `strictPort`, `server.proxy` for `/price`, `/state`, `/job`, `/pass`, `/.well-known` → `http://localhost:3000` (same origin, no CORS).
- `main.ts`: poll `/state` every 1000 ms. Show current price big + queue depth; queue table (label, paid sats or "PASS", position); served table (label, paid sats, wait s = `(startedAt − enqueuedAt) / 1000`, WhatsOnChain link). Empty states "Queue empty" / "No jobs yet". Form: prompt + bid (prefilled with price) + **Pay with BSV Desktop** → `new AuthFetch(new WalletClient('auto')).fetch(\`${location.origin}/job\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, bid: Number(bid), label: 'You' }) })`; show a 400's `error` inline; on success poll `/job/:id` and show the result. Plain HTML/CSS.

- [ ] Hours 0.5–1.5: build against a hard-coded sample `MarketSnapshot`, then switch to the live server.
- [ ] Check (no spend): empty queue → price 100, "Queue empty", "No jobs yet"; bid 50 → inline "bid below surge price".
- [ ] **One BSV Desktop approval:** submit a job → labelled "You", served, result shown, link works. If the auth handshake fails through the proxy: `vite build web` and serve `web/dist` from Express with `express.static`.
- [ ] Commit `feat: dashboard + BSV Desktop pay flow`.

### T8: Priority pass (BSV-21) — issue, redeem, resell

**Files:** `scripts/deployPass.ts`, `src/pass.ts`, `scripts/resell.ts`, `test/pass.e2e.test.ts`

Uses the kit's `TokenKit` (`src/kit/client/token.ts`: `new TokenKit(wallet, overlay, originator?)`, `deploy({ sym, amt, dec })`, `send(tokenId, amount, to)`, `overlayUtxos(identityKey, tokenId)`, `sync()`) and `OverlayClient` (`src/kit/client/overlayApi.ts`). Follow AGENTS.md BSV-21 rules: the overlay is the source of truth, submit every token tx to it in order, tokens in a named basket never `default`.

- `deployPass.ts`: provider wallet deploys `{ sym: 'SURGEPASS', amt: 100n, dec: 0 }`; prints `tokenId` (`<txid>_<vout>`) and a BananaBlocks link; team copies it into `.env` as `PASS_TOKEN_ID`.
- `createPassService (provider: WalletInterface, overlay: OverlayClient, tokenId: string): Promise<PassService>`:
  - `issue(to)` → `TokenKit.send(tokenId, 1n, to)` → `{ txid }`.
  - `redeem(passTxid, from)` → `sync()`, then true only if the overlay lists a provider-owned `tokenId` output with that txid, amount 1, not redeemed before (in-memory `Set`; `// ponytail: redeemed set lost on restart, persist if passes outlive a demo`).
- Pass use from an agent: `TokenKit.send(tokenId, 1n, providerIdentityKey)` → `POST /job/pass { prompt, passTxid }` via `AuthFetch`.
- `resell.ts <from> <to> <priceSats>`: buyer pays seller `priceSats` with `createBrc29Payment` → seller accepts → seller `send(tokenId, 1n, buyerIdentityKey)`; prints both links. Pay-then-transfer, not atomic (README states it; atomic OrdLock swap is future work).

- [ ] Test on the mock chain following the kit's `test/e2e.mockchain.test.ts` overlay setup: `issued pass can be redeemed once` (issue to alice → alice sends it back → `redeem` true → same txid again false) and `a non-pass txid is refused`.
- [ ] `npm run overlay` running; **team OK:** `npm run deploy-pass` → tokenId in `.env`; restart server.
- [ ] Mainnet: an agent buys a pass (`POST /pass`), resells it (`npm run resell -- A B 400`), the buyer redeems it during a burst and shows at position 1 on the dashboard.
- [ ] Commit `feat: BSV-21 priority pass — issue, redeem, resell`.

### T9: README, value note, submission

**Files:** `README.md`, `VALUE.md`

- [ ] `README.md`: pitch; data-flow diagram (§6); setup (`npm install`, `keygen`, `fund`, `overlay`, `deploy-pass`, `server`, `web`, `demo`, `llm-agent`); non-custodial design; known limits (restart drops queued paid jobs and the redeemed-pass set; resale is pay-then-transfer); all WhatsOnChain/BananaBlocks links from the rehearsal; stack list (BRC-100, 103/104, 105, 29, BSV-21, overlay, wallet-toolbox, Arcade, Claude tool use).
- [ ] `VALUE.md` (one page): problem, target users (AI API providers, agent builders), how people use it, value to BSV (per-call micropayments card rails can't price; agents as paying users; a tradable capacity asset).
- [ ] `npm test` + `npm run typecheck` green; `git status` shows no `.env` / `.local/`.
- [ ] Commit `docs: README + value note`.
- [ ] **Team decision (outward-facing):** create the public GitHub repo and push; record the 2–3 min video (§7); submit with WhatsOnChain links and the value note.

---

## 6. Data flow

```
 Scripted agents ─┐                                  ┌─► Price engine (queue depth → price)
 LLM agent ───────┼─ GET /price ─────────────────────┘          ▲
 Human (Desktop) ─┘                                             │
        │ POST /job { prompt, bid }                             │
        ▼                                                       │
 Validation (prompt, bid ≥ surge) → Auth (BRC-103/104) → Payment (BRC-105, price = bid)
        │   payer wallet → provider wallet (BRC-29 tx, Arcade)  │
        ▼                                                       │
 Priority queue (pass → paid sats desc → arrival) ──────────────┘
        ▼
 Worker → runJob (mock AI) → GET /job/:id → result + txid
        ▼
 Dashboard (GET /state every 1 s): price, queue, served jobs, WhatsOnChain links

 Pass: POST /pass (pay 500) → provider sends 1 SURGEPASS → (optional resale A→B)
       → holder sends it back → POST /job/pass → front of the queue
```

## 7. Demo script (2–3 min video)

1. Quiet API: price 100, one job served instantly.
2. `npm run demo`: A and B flood in, queue grows, price climbs live.
3. C (high urgency) arrives late, outbids, is served next.
4. LLM agent: show its one-line decisions ("deadline close, bidding 450") and its payments.
5. Agent A resells its pass to B; B redeems it and jumps to position 1.
6. A human pays from BSV Desktop on the dashboard.
7. Click a served job → the transaction on WhatsOnChain; the pass token on BananaBlocks.
8. Closing line: per-call AI capacity priced live, paid by agents, non-custodial, on BSV.
