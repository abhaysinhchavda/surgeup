# SurgeUp: usage and value

## The problem

In the near future, AI agents are starting to buy API calls on their own instead of humans, but in the case of overloading of API requests how can we determine which request will be prioritized and executed first? Due to the current way APIs are still selling to people - only monthly plans, API keys, flat per-call prices - an agent racing a deadline is currently treated inefficiently with the same priority as another agent doing only background work. Therefore, when capacity is short, the more urgent call has to wait in an efficient manner behind the routine one. This is very detrimental to not only the speed & the smoothness of running API calls, but also stalls or even slows down the transaction traffic/volume. Plus, the agent has no way to say "this one matters, I'll pay more."

## What SurgeUp does

SurgeUp turns API capacity into a live market, settled in sats on BSV. In this way, in the case of overloading of API calls, instead of simply rejecting requests with "429 too many requests" error message, SurgeUp auctions the next free slots for sats:

- **Surge pricing.** Each call pays a price that rises with queue depth. Callers can bid above it, and the highest bid is served next.
- **SURGEPASS swap (the DeFi core).** A BSV-21 token sold on a bonding curve: 300 sats plus 50 for every pass in circulation. A pass buys one queue-jumping call. Redeemed passes flow back to the provider, so the price tracks demand both ways.
- **Agents that choose.** For every task an agent compares its surge bid with the pass price and takes the cheaper route: pay the surge in sats, or swap into a pass and redeem it.

No accounts and no API keys: the API answers HTTP 402, the caller's wallet pays, the call goes through (BRC-105).

## Who uses it

- **AI agent builders** who need a way to pay per call, with priority when it matters, without handing out API keys or prepaying a plan.
- **API and model providers** with scarce capacity (GPU inference, data feeds) who want bidding price to allocate it instead of rate limits, and to be paid instantly per call.
- **People** who want a one-off call without signing up: they pay from BSV Desktop (Wallet) and get the result.

## How people use it

1. An agent (or person) reads the price from `GET /price` or the dashboard.
2. It posts a job with its bid, or swaps into a SURGEPASS when that's cheaper.
3. Its own wallet pays the provider directly; the job is queued by priority and the result comes back with a WhatsOnChain link.

Funds never pass through SurgeUp: each payment goes straight from the payer's wallet to the provider's.

## Values that SurgeUp creates for BSV Blockchain

- **New users through agents.** Any agent framework can plug in with a wallet and an HTTP client. Each new agent is a new BSV wallet that transacts on its own, around the clock.
- **Rising liquidity.** Faster speed of processing API requests lead to higher traffic, which in turn leads to higher transaction volume and thus increasing liquidity.
- **Transaction volume that fits BSV.** Every call, swap and redemption is an on-chain transaction worth a few hundred sats. That pattern only works with BSV's fees; on high-fee chains the fee would exceed the payment.
- **A real use for BSV-21 tokens.** SURGEPASS has utility (priority) and a price discovered on-chain, a template providers can reuse to sell capacity, credits or access.
- **Standard BSV stack, end to end.** Built on the BSV TypeScript SDK, Wallet Toolbox, BRC-100 wallets (BSV Desktop), BRC-103/104 auth and BRC-105 payments, so others can copy it.

Live demo: https://surgeup.vercel.app/ · Example transactions: see the [README](README.md#example-transactions-mainnet-whatsonchain).
