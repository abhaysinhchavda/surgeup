# SurgeUp demo video script (2:25)

Demo: https://surgeup.vercel.app/ · Track: BSV Blockchain, DeFi Rails for Agentic Payments.
About 330 words of voiceover at a relaxed pace. Record the screen at 1080p, browser zoom 110%.

**Before recording:** server, overlay and tunnel running; agent wallet funded; BSV Desktop open and unlocked; a WhatsOnChain tab ready for the tx you will click.

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:15** Hook | SurgeUp logo, then the **Overview** page. | "AI agents are starting to pay for APIs on their own. But a flat API price treats every call the same, whether it's urgent or not. SurgeUp is a pay-per-call AI API on BSV with a live priority market, and a DeFi token that agents can swap into to jump the queue." |
| **0:15–0:35** The market | Hover the surge chart; point at the price KPI and Queue depth. | "Every call pays a surge price in sats that rises with queue depth. Callers can bid above it, and the highest bid is served next. Payments are BRC-105: the API answers 402, the wallet pays, the call goes through. No accounts, no API keys, no custody." |
| **0:35–0:55** The DeFi core | Scroll to **SURGEPASS swap**; hover the curve. | "The DeFi core is SURGEPASS, a BSV-21 token sold on a bonding curve: 300 sats plus 50 for every pass in circulation. Supply is read from the overlay, so a redeemed pass flows back and the price falls again. When the surge is high, a pass is the cheaper way to the front." |
| **0:55–1:30** The agent pays | **Agent** page. Pick Finance (urgent case) and Legal; click **Run agents**. Let the console stream: THINK, SWAP, PAY lines; a gold pass tile jumps to the front of the queue. | "Here's the agent. I give two agents a budget and a task list. For each task it reads the surge price and the pass price, and takes the cheaper route. This urgent task would cost a high surge bid, so the agent swaps sats into SURGEPASS, sends the pass back and lands at the front of the queue. The cheaper one it simply pays in sats. Every line is a real mainnet transaction, paid from the agent's own wallet, and it never goes over budget." |
| **1:30–1:45** Proof on chain | Click a **view tx ↗** link → WhatsOnChain opens with the tx. Back to **Agent performance**. | "Every payment is on WhatsOnChain. Agent performance shows the success rate and spend against budget for each agent." |
| **1:45–2:00** A human pays too | **Human interaction** card: type a prompt, bid 100, **Pay & queue**; approve in BSV Desktop; result appears. | "Humans use the same rails. From BSV Desktop I pay for one call myself: the wallet approves, the job queues, the result comes back. Keys never leave the wallet." |
| **2:00–2:15** Network impact | **Transaction history**, then **Overview → Network impact**. | "Every paid call, swap and top-up is an on-chain BSV transaction. This page counts what SurgeUp has brought to the network: transactions, sats to API providers and paying wallets." |
| **2:15–2:25** Close | Logo, URL and repo on screen. | "SurgeUp: surge pricing and a token swap that give agents a real reason to pay on BSV. Built with the BSV SDK, Wallet Toolbox and BSV Desktop. Try it at surgeup.vercel.app." |

## How each requirement shows up

| Requirement / judging criterion | Where in the video |
|---|---|
| DeFi product is the core (swap into the right token) | 0:35 swap curve; 0:55 agent swaps into SURGEPASS |
| At least one AI agent makes a payment | 0:55–1:30 |
| Real transactions, links on WhatsOnChain | 1:30 |
| BSV wallets (BSV Desktop) for user flows | 1:45 |
| Non-custodial | 0:15 "no custody"; 1:45 "keys never leave the wallet" |
| SDK + Wallet Toolbox | 2:15 close (also say it while showing the README if time allows) |
| Adoption, value to BSV (35%) | 0:00 hook; 2:00 network impact |

## Tips

- If the agent run is slow, record it once and cut the waiting, keeping the SWAP line and the queue jump visible.
- Keep narration over the action instead of pausing for it; the total is about 2:25, so there is 5 seconds of slack.
- The swap only fires when the agent's bid beats the pass price (300 sats). An urgent task bids 3× the surge, so it swaps as soon as one job is waiting (surge 150 → bid 450). With an empty queue the bid is exactly 300 and it pays in sats instead, so run two agents together, or queue one job first.
