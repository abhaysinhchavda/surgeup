/**
 * ElevenLabs voiceover, one MP3 per scene of SurgeUpDemo, into public/voiceover/.
 *   node --env-file=.env --strip-types generate-voiceover.ts
 * Needs ELEVENLABS_API_KEY in video/.env (git-ignored). ELEVENLABS_VOICE_ID is optional.
 * Each line is sized to its scene (about 2.5 words per second).
 */
import { mkdirSync, writeFileSync } from "node:fs";

const SCENES: Array<{ id: string; text: string }> = [
  { id: "01-hook", text: "This is SurgeUp: a priority market for AI API calls, paid on BSV." },
  { id: "02-problem", text: "AI agents now pay for APIs on their own. But a flat price treats every call the same, urgent or not." },
  { id: "03-market", text: "In SurgeUp, every call pays a surge price in sats that rises with queue depth. Bid above it, and the highest bid is served next. The API answers four-oh-two, the wallet pays. No accounts, no API keys, no custody." },
  { id: "04-swap", text: "The DeFi core is SURGEPASS, a BSV-21 token sold on a bonding curve: three hundred sats, plus fifty for every pass in circulation. Redeemed passes flow back, so the price falls again." },
  { id: "05-agents", text: "Each agent gets a budget and a task list. For every task, it compares its surge bid with the pass price, and takes the cheaper route." },
  { id: "06-agent-log", text: "Here, the logistics agent swapped into a SURGEPASS for three hundred sats, sent it back, and landed at queue position one. Every line is a real mainnet transaction." },
  { id: "07-proof", text: "Every payment links to WhatsOnChain. Agent performance shows success rate and spend against budget. No agent overspends." },
  { id: "08-human", text: "People use the same rails from BSV Desktop. The wallet approves, the job queues, and keys never leave the wallet." },
  { id: "09-network", text: "Every paid call, swap and top-up is an on-chain BSV transaction, built on the BSV SDK, Wallet Toolbox and BSV Desktop." },
  { id: "10-close", text: "SurgeUp. A real reason for agents to pay on BSV. Try it at surgeup dot vercel dot app." },
];

const key = process.env.ELEVENLABS_API_KEY;
if (key === undefined || key === "") throw new Error("ELEVENLABS_API_KEY missing: add it to video/.env");
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // "George", an ElevenLabs premade voice

mkdirSync("public/voiceover", { recursive: true });
for (const scene of SCENES) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: scene.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`${scene.id}: ElevenLabs ${res.status} ${await res.text()}`);
  writeFileSync(`public/voiceover/${scene.id}.mp3`, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote public/voiceover/${scene.id}.mp3`);
}
