# SurgeAPI

**A pay-per-call AI API on BSV with a live priority market.** Every call pays a surge price in sats that rises with queue depth; callers can bid above it, and the highest-paid job is served next. AI agents pay for themselves from their own wallets. A BSV-21 priority pass lets a holder jump the queue, and it can be resold.

Built for the TUM Blockchain & AI Hackathon 2026 — BSV Association track. Work plan: [TASKS.md](TASKS.md).

> Setup, demo links and the value note are filled in by task T9.

## Architecture

```mermaid
flowchart TB
  subgraph Clients["Clients — each pays from its own wallet"]
    SA["Scripted agents<br/>urgency bids"]
    LLM["LLM agent<br/>Claude + sats budget"]
    HU["Human<br/>BSV Desktop (BRC-100)"]
    DB["Dashboard :5173<br/>polls /state"]
  end

  subgraph Server["SurgeAPI server :3000"]
    VAL["Validation<br/>prompt, bid ≥ surge"]
    PAY["Auth + payment<br/>BRC-103/104, BRC-105"]
    FREE["Free routes<br/>/price /state /job/:id"]
    MKT["Market + queue<br/>pass › sats › time"]
    WRK["Worker<br/>mock runJob"]
    PASS["Pass service<br/>issue, redeem"]
  end

  subgraph BSV["BSV network"]
    ARC["Arcade<br/>broadcast, headers"]
    OVL["Token overlay :8080<br/>SURGEPASS state"]
    WOC["WhatsOnChain<br/>proof links"]
  end

  SA --> VAL
  LLM --> VAL
  HU --> VAL
  DB --> FREE
  VAL --> PAY --> MKT --> WRK
  PAY -. "payer wallet → provider wallet (BRC-29)" .-> ARC
  PASS --> OVL
  WRK -. txids .-> WOC
```

Payments go straight from the payer's wallet to the provider's wallet. The server never holds anyone else's funds.

## Data flow of one job

```mermaid
flowchart TB
  A["Agent or human<br/>GET /price, choose bid"] --> B["POST /job { prompt, bid }<br/>validate — bid below surge → 400, no charge"]
  B --> C["402 challenge<br/>price = bid (BRC-105)"]
  C --> D["BRC-29 payment tx<br/>payer wallet → provider"]
  D --> E["Enqueue job<br/>priority = sats paid"]
  E --> F["Worker serves<br/>pass first, then highest sats"]
  F --> G["Poll GET /job/:id<br/>result + WhatsOnChain txid"]
  E --> S["Surge price rises<br/>base × (1 + k · depth)"]
  S -. next bid .-> A

  P1["Buy or resell a pass<br/>500 sats, BSV-21"] --> P2["Pass holder<br/>sends 1 SURGEPASS back"]
  P2 -- "POST /job/pass (verified on the overlay)" --> E
```

A pass holder skips payment and enters the queue at position 1.
