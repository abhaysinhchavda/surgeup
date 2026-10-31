# SURGEPASS Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a DeFi product the core of SurgeAPI: a bonding-curve swap from sats into the SURGEPASS token, and agents that decide per task whether to pay the surge in sats or swap into a pass and redeem it for the call.

**Architecture:** The provider sells SURGEPASS (BSV-21, 100 supply) at a price set by a linear curve over the passes in circulation, read from the overlay as `supply − provider balance` so it survives restarts. `POST /pass` charges the curve price; `GET /price` and a new `GET /swap` publish it. The scripted agent compares its sats bid with the pass price and takes the cheaper route; the dashboard shows the curve and every swap.

**Tech Stack:** TypeScript, Express 5, @bsv/sdk, @bsv/wallet-toolbox, the repo's BSV-21 kit (`src/kit`) and overlay (`npm run overlay`), vitest, Vite.

**Spec:** the Design section below (no separate spec; agreed in chat on 2026-10-31).

## Design

- **Why:** the hackathon brief says the DeFi product is the core; the agent can be simple, e.g. one that swaps into the right token and pays for an API call. Today nothing swaps and SURGEPASS is switched off on the live server.
- **The swap (sats → SURGEPASS):** `passPrice(outstanding) = PASS_BASE_SATS + PASS_STEP_SATS × outstanding` with `PASS_BASE_SATS = 300`, `PASS_STEP_SATS = 50`, `PASS_SUPPLY = 100`. `outstanding = PASS_SUPPLY − provider's SURGEPASS balance on the overlay`. A redeemed pass returns to the provider, so the price falls again: the curve tracks demand both ways.
- **What a pass buys:** one job that jumps the queue (existing `POST /job/pass`, `viaPass: true`, `paidSats: 0`).
- **Agent rule (scripted mode):** per task, `bid = min(bidFor(urgency, surge), valueSats)` as today. If passes are on, `passSats < bid`, and the budget allows `passSats`, the agent swaps: pay `POST /pass`, send the pass back to the provider, `POST /job/pass`. Otherwise it pays the surge in sats as today. Each choice is logged with both prices.
- **Out of scope:** selling passes back for sats (provider-paid buyback), a Claude-mode swap tool, holding passes across tasks. Each is a follow-up once this ships.
- **Going live:** start the overlay as a long-running service, deploy SURGEPASS from the provider wallet (one mainnet transaction, needs the user's go-ahead), append `PASS_TOKEN_ID` to `.env`, restart the server.

## Global Constraints

- Keys never leave the wallet: never read, print or commit `.env` values; append `PASS_TOKEN_ID=<id>` with `>>` only.
- Every mainnet transaction outside an agent run the user starts (the deploy) needs the user's explicit OK first.
- Requests that would be refused are rejected before the payment middleware, so nobody pays for a pass they cannot get.
- Server-supplied strings render with `textContent` on the dashboard.
- Vercel rewrites stay per-route (never one `/:route/:rest*` pattern: it breaks BRC-104 auth).
- Commit and push only when the user asks.

## Review Focus

1. Passes sold out (provider balance 0): `POST /pass` answers 409 `sold out` before any payment.
2. Overlay down or slow: `/price` returns `passSats: null`, agents fall back to paying sats, nothing throws.
3. Curve price rises between the 402 challenge and the paid retry: the buyer pays the price quoted in their challenge; a reused or unknown challenge pays the live price (same rule as `/job`).
4. Pass bought and sent back, but `POST /job/pass` fails: the agent logs an error with the pass txid; the budget counts the pass price once.
5. Agent budget below the pass price but above the sats bid: it pays sats, never overspends.

---

### Task 1: Curve and pass price from the overlay

**Files:**
- Modify: `src/pass.ts`
- Test: `test/pass.e2e.test.ts`, new `test/curve.test.ts`

**Interfaces:**
- Produces: `export const PASS_SUPPLY = 100`, `PASS_BASE_SATS = 300`, `PASS_STEP_SATS = 50`; `export const passPrice = (outstanding: number): number`; `PassService.quote(): Promise<{ priceSats: number, outstanding: number, supply: number, soldOut: boolean }>` (cached 2 s, cache cleared after `issue`/`redeem`).

- [ ] **Step 1: Failing tests.** `test/curve.test.ts`: `passPrice(0) === 300`, `passPrice(4) === 500`, `passPrice(99) === 5250`. In `test/pass.e2e.test.ts` (token deployed with `amt: 100n` in `beforeAll`): `quote()` before any issue is `{ priceSats: 300, outstanding: 0, supply: 100, soldOut: false }`; after one `issue` it is `priceSats: 350, outstanding: 1`; after that pass is sent back and redeemed, `outstanding: 0` again.
- [ ] **Step 2: Run** `npx vitest run test/curve.test.ts test/pass.e2e.test.ts`. Expected: FAIL (`passPrice` / `quote` not defined).
- [ ] **Step 3: Implement** in `src/pass.ts`. `quote()` runs `kit.sync()`, sums `BigInt(o.ctx.amt)` over `kit.overlayUtxos(providerKey, tokenId)`; `outstanding = PASS_SUPPLY − balance`; `soldOut = balance === 0n`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: SURGEPASS bonding-curve quote`.

### Task 2: Server charges the curve price

**Files:**
- Modify: `src/server.ts` (remove `PASS_SATS`; `/price`, new `GET /swap`, `/pass` pre-check and price), `vercel.json` (add `/swap` rewrite next to `/network`), `web/vite.config.ts` (add `/swap` to the proxy list)
- Test: `test/surge.e2e.test.ts` (its `fakePasses` gains `quote`)

**Interfaces:**
- Consumes: `PassService.quote()` from Task 1.
- Produces: `GET /price` → `{ priceSats, queueDepth, passSats: number | null }`; `GET /swap` → `{ enabled: boolean, priceSats?, outstanding?, supply?, soldOut?, curve?: Array<{ outstanding: number, priceSats: number }> }` (curve sampled every 10 passes, 0–100).

- [ ] **Step 1: Failing tests.** With `fakePasses.quote` returning `{ priceSats: 350, outstanding: 1, supply: 100, soldOut: false }`: `/price` has `passSats: 350`; `POST /pass` charges exactly 350 (provider balance +350). With `soldOut: true`: `POST /pass` is 409 `{ error: 'sold out' }`, provider balance unchanged. With `quote` rejecting: `/price` has `passSats: null`; `POST /pass` is 503 `{ error: 'pass price unavailable' }`, uncharged. With no `PassService`: `/swap` is `{ enabled: false }`, `/price` has `passSats: null`. Replace the old `buying a pass charges PASS_SATS` test and the `passSats: 500` expectation in `price endpoint starts at base`.
- [ ] **Step 2: Run** `npx vitest run test/surge.e2e.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.** The `/pass` pre-check (after auth, before payment) awaits `quote()`, refuses 409/503 as above, and stores the price on the request. For a paid retry it uses the price recorded for that challenge's derivation prefix, reusing the `/job` challenge pattern (map keyed by prefix, `CHALLENGE_TTL_MS`, one retry per challenge). `calculateRequestPrice` returns the stored price for `/pass`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: /pass charges the SURGEPASS curve price`.

### Task 3: Agents choose between sats and a swap

**Files:**
- Modify: `src/agentRuns.ts` (`runScripted`, `createAgentRunner`, `LogKind` gains `'swap'`), `src/main.ts` (pass `{ tokenId, overlayUrl }` to the runner when passes are on)
- Test: `test/pass.e2e.test.ts` (mock chain + real overlay already set up there)

**Interfaces:**
- Consumes: `/price` `passSats`, `POST /pass`, `POST /job/pass`, `GET /provider` from Task 2; `TokenKit.send(tokenId, 1n, providerKey)`.
- Produces: `createAgentRunner({ …, passes?: { tokenId: string, overlayUrl: string } })`; `runScripted({ …, swap?: { kit: TokenKit, tokenId: string } })`; log kind `'swap'` with text like `surge bid 450 > pass 350 → swapping sats into SURGEPASS`.

- [ ] **Step 1: Failing tests** in `test/pass.e2e.test.ts`: start `createSurgeApp` with the real `PassService` and a market holding 4 queued jobs (live surge 300); run `runScripted` for one task with `deadlineSec: 30` (high urgency) and `valueSats: 2000`, budget 1000, `swap` set. Expect one log line of kind `swap`, the queued job has `viaPass: true`, and `budget.spentSats === 300`. Second test: same with budget 200 → no `swap` line and `spentSats <= 200`.
- [ ] **Step 2: Run** `npx vitest run test/pass.e2e.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Design rule in `runScripted`. Swap path: `POST /pass` with AuthFetch, `await kit.sync()`, `kit.send(tokenId, 1n, providerKey)`, `POST /job/pass` with the agent's label. Add the pass price to `budget.spentSats` once, right after `/pass` returns 200. Any failure after paying logs `error` with the pass txid and moves on to the next task.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: agents swap into SURGEPASS when it beats the surge`.

### Task 4: Dashboard swap panel

**Files:**
- Modify: `web/index.html`, `web/main.ts`

**Interfaces:**
- Consumes: `GET /swap` from Task 2; log kind `'swap'` from Task 3.

- [ ] **Step 1: Build** an Overview card "SURGEPASS swap" under Network impact: current pass price, passes in circulation `outstanding / supply`, and the curve as a single-series SVG line (price vs passes in circulation) with the current point marked and a hover tooltip, per the dataviz skill's mark specs. When `/swap` says `enabled: false`, the card reads "Swap not live yet". On Live Market the subtitle shows "Pass price N sats" beside the surge. Log lines of kind `swap` get their own color and an entry in the event filter.
- [ ] **Step 2: Verify** in the browser with a stubbed `/swap` (as done for the queue visual): curve renders, tooltip works, the disabled state shows, no horizontal scroll at 375 px; `npx tsc --noEmit -p .` clean.
- [ ] **Step 3: Commit** `feat: SURGEPASS swap panel on the dashboard`.

### Task 5: Go live on mainnet (needs the user's OK)

**Files:**
- Modify: `.env` (append only), `README.md` (one paragraph on the swap)

- [ ] **Step 1: Start the overlay** as a background service: `npm run overlay`; `http://localhost:8080` answers.
- [ ] **Step 2: Ask the user**, then `npm run deploy-pass` (one mainnet transaction from the provider wallet). Expected output: a WhatsOnChain link and `PASS_TOKEN_ID=<id>`.
- [ ] **Step 3: Append** `PASS_TOKEN_ID=<id>` to `.env` with `>>`, restart `npm run server`; the server log shows `Passes enabled: <id>`.
- [ ] **Step 4: Verify live:** `https://surgeapi.vercel.app/swap` shows `enabled: true`, price 300, outstanding 0. One agent run, started by the user, shows a `swap` line with a tx link.
- [ ] **Step 5: Commit** `docs: SURGEPASS swap live` (README only; never `.env`).
