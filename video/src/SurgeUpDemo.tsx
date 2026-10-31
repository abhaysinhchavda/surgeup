import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FONT = "Inter, 'Segoe UI', system-ui, sans-serif";
const BG = "#0b0b0f";
const BLUE = "#5b7cff";
const GOLD = "#ffd54a";
const CAPTION_H = 230;

type Rect = readonly [x: number, y: number, w: number, h: number];

const fade = (frame: number, duration: number): number =>
  interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Subtitles: the voiceover lines, shown one after another across the scene. */
const Captions: React.FC<{ lines: string[]; duration: number }> = ({
  lines,
  duration,
}) => {
  const frame = useCurrentFrame();
  const per = duration / lines.length;
  const i = Math.min(lines.length - 1, Math.floor(frame / per));
  const local = frame - i * per;
  const opacity = interpolate(local, [0, 8, per - 8, per], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: CAPTION_H,
        display: "flex",
        background: "linear-gradient(180deg, rgba(11,11,15,0.85), #0b0b0f)",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 140px",
      }}
    >
      <div
        style={{
          opacity,
          color: "#fff",
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: "center",
        }}
      >
        {lines[i]}
      </div>
    </div>
  );
};

const Chip: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      position: "absolute",
      top: 60,
      left: 80,
      padding: "12px 26px",
      borderRadius: 999,
      background: "rgba(0,63,255,0.85)",
      color: "#fff",
      fontFamily: FONT,
      fontSize: 34,
      fontWeight: 700,
      letterSpacing: 1,
      boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
    }}
  >
    {label}
  </div>
);

/** A screenshot of the live demo, with the camera moving from one region to another. */
const Shot: React.FC<{
  src: string;
  width: number;
  from: Rect;
  to: Rect;
  label: string;
  lines: string[];
}> = ({ src, width, from, to, label, lines }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [10, durationInFrames - 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const [x, y, w, h] = from.map((v, k) => v + (to[k] - v) * t);
  const viewH = 1080 - CAPTION_H;
  const scale = Math.min(1920 / w, viewH / h) * 0.94;
  const tx = 960 - (x + w / 2) * scale;
  const ty = viewH / 2 - (y + h / 2) * scale;
  return (
    <AbsoluteFill
      style={{ background: BG, opacity: fade(frame, durationInFrames) }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          width,
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      />
      <Chip label={label} />
      <Captions lines={lines} duration={durationInFrames} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{
  title: string;
  subtitle: string;
  url?: string;
}> = ({ title, subtitle, url }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const rise = interpolate(frame, [0, fps], [40, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 70% 0%, rgba(0,63,255,0.35), transparent 60%), ${BG}`,
        justifyContent: "center",
        alignItems: "center",
        opacity: fade(frame, durationInFrames),
        fontFamily: FONT,
      }}
    >
      <div style={{ transform: `translateY(${rise}px)`, textAlign: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 220, height: 220 }} />
        <div
          style={{
            fontSize: 140,
            fontWeight: 800,
            letterSpacing: -3,
            color: "#fff",
            marginTop: 20,
          }}
        >
          Surge<span style={{ color: GOLD }}>Up</span>
        </div>
        <div
          style={{
            fontSize: 52,
            color: "#c8d2ff",
            marginTop: 10,
            padding: "0 120px",
          }}
        >
          {subtitle}
        </div>
        {url !== undefined ? (
          <div
            style={{
              fontSize: 48,
              color: BLUE,
              marginTop: 40,
              fontWeight: 700,
            }}
          >
            {url}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 70,
          fontSize: 32,
          color: "#8a93b8",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const S = 30; // fps

export const SurgeUpDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Sequence name="Hook" from={0} durationInFrames={7 * S}>
        <TitleCard
          title="TUM Blockchain & AI Hackathon 2026 · BSV Track"
          subtitle="A priority market for AI API calls, paid on BSV"
        />
      </Sequence>
      <Sequence name="Problem" from={7 * S} durationInFrames={10 * S}>
        <Shot
          src="shots/overview.png"
          width={1920}
          from={[0, 0, 1920, 1080]}
          to={[456, 95, 1240, 172]}
          label="The problem"
          lines={[
            "AI agents now pay for APIs on their own.",
            "But a flat price treats every call the same, urgent or not.",
          ]}
        />
      </Sequence>
      <Sequence name="Market" from={17 * S} durationInFrames={18 * S}>
        <Shot
          src="shots/overview.png"
          width={1920}
          from={[456, 95, 1240, 172]}
          to={[456, 95, 420, 172]}
          label="Surge pricing"
          lines={[
            "Every call pays a surge price in sats that rises with queue depth.",
            "Bid above it, and the highest bid is served next.",
            "BRC-105: the API answers 402, the wallet pays. No accounts, no API keys, no custody.",
          ]}
        />
      </Sequence>
      <Sequence name="Swap" from={35 * S} durationInFrames={20 * S}>
        <Shot
          src="shots/overview.png"
          width={1920}
          from={[456, 483, 1240, 251]}
          to={[456, 483, 700, 251]}
          label="The DeFi core: SURGEPASS"
          lines={[
            "SURGEPASS is a BSV-21 token sold on a bonding curve.",
            "300 sats, plus 50 for every pass in circulation.",
            "Redeemed passes flow back, so the price falls again.",
          ]}
        />
      </Sequence>
      <Sequence name="Agents" from={55 * S} durationInFrames={18 * S}>
        <Shot
          src="shots/market.png"
          width={1920}
          from={[457, 407, 1239, 1004]}
          to={[457, 407, 900, 1004]}
          label="The agent pays"
          lines={[
            "Each agent gets a budget and a task list.",
            "For every task it compares the surge bid with the pass price, and takes the cheaper route.",
          ]}
        />
      </Sequence>
      <Sequence name="AgentLog" from={73 * S} durationInFrames={17 * S}>
        <Shot
          src="shots/market.png"
          width={1920}
          from={[1152, 420, 529, 761]}
          to={[1152, 846, 529, 335]}
          label="Swap, then jump the queue"
          lines={[
            "Here the Logistics agent bought a SURGEPASS for 300 sats...",
            "...sent it back, and landed at queue position 1.",
            "Every line is a real mainnet transaction from the agent's own wallet.",
          ]}
        />
      </Sequence>
      <Sequence name="Proof" from={90 * S} durationInFrames={15 * S}>
        <Shot
          src="shots/market.png"
          width={1920}
          from={[986, 99, 710, 288]}
          to={[457, 1433, 1239, 291]}
          label="Proof on chain"
          lines={[
            "Every payment links to WhatsOnChain, including the pass redemption.",
            "Agent performance: success rate and spend against budget. No agent overspends.",
          ]}
        />
      </Sequence>
      <Sequence name="Human" from={105 * S} durationInFrames={13 * S}>
        <Shot
          src="shots/market.png"
          width={1920}
          from={[457, 1742, 1239, 157]}
          to={[1300, 1742, 400, 157]}
          label="Humans pay too"
          lines={[
            "People use the same rails from BSV Desktop.",
            "The wallet approves, the job queues. Keys never leave the wallet.",
          ]}
        />
      </Sequence>
      <Sequence name="Network" from={118 * S} durationInFrames={17 * S}>
        <Shot
          src="shots/overview.png"
          width={1920}
          from={[0, 0, 1920, 1080]}
          to={[456, 281, 1240, 186]}
          label="Value to BSV"
          lines={[
            "Every paid call, swap and top-up is an on-chain BSV transaction.",
            "Built on the BSV SDK, Wallet Toolbox and BSV Desktop.",
          ]}
        />
      </Sequence>
      <Sequence name="Close" from={135 * S} durationInFrames={10 * S}>
        <TitleCard
          title="Built with the BSV TypeScript SDK · Wallet Toolbox · BSV Desktop"
          subtitle="Surge pricing + a token swap: a real reason for agents to pay on BSV"
          url="surgeup.vercel.app"
        />
      </Sequence>
    </AbsoluteFill>
  );
};
