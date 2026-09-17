// Adapted from Beautiful UI. See docs/licenses/beautiful-ui.txt.
import { useState, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { ElapsedTime } from "./elapsed-time";
import { StableShimmer } from "./stable-shimmer";
import "./thinking-state.css";

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3), column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, index) => {
  const position = ORBIT_ORDER.indexOf(index);
  return position === -1 ? null : position * 110;
});
const PATTERNS = {
  Drive: { delays: chevron, duration: 650, round: false },
  Dots: { delays: chevron, duration: 650, round: true },
  Orbit: { delays: orbit, duration: 950, round: false },
};
export type LoadingVariant = keyof typeof PATTERNS | "Surfer";

function LoaderGrid({ variant = "Drive" }: { variant?: keyof typeof PATTERNS }) {
  const { delays, duration, round } = PATTERNS[variant];
  return (
    <span aria-hidden="true" className="pixel-loader-grid" data-round={round}>
      {delays.map((delay, index) => (
        <span
          key={index}
          className="pixel-loader-cell"
          data-inactive={delay === null}
          style={{ "--pixel-duration": `${duration}ms`, "--pixel-delay": `${delay ?? 0}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}

function SurferVideo({ src }: { src: string }) {
  const [videoOk, setVideoOk] = useState(true);
  const reducedMotion = useReducedMotion();
  return (
    <span className="loading-video-card">
      {videoOk ? (
        <video
          key={String(reducedMotion)}
          src={src}
          autoPlay={!reducedMotion}
          controls={Boolean(reducedMotion)}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Subway Surfers"
          onError={() => setVideoOk(false)}
        />
      ) : (
        <span className="loading-video-fallback"><LoaderGrid /><span>Video unavailable</span></span>
      )}
    </span>
  );
}

export default function LoadingState({
  label,
  detail,
  variant = "Drive",
  videoSrc = "https://95dnc2a95qgwt9ff.public.blob.vercel-storage.com/subway-surfers.mp4",
  className = "",
}: {
  label?: string;
  detail?: string;
  variant?: LoadingVariant;
  videoSrc?: string;
  className?: string;
}) {
  const surfer = variant === "Surfer";
  const resolvedLabel = label ?? (surfer ? "Subway surfing" : "Churning");
  return (
    <span className={`loading-state ${className}`}>
      <span role="status" aria-label={resolvedLabel} className="loading-state-status">
        <LoaderGrid variant={surfer ? "Drive" : variant} />
        <span className="loading-state-copy">
          <StableShimmer text={resolvedLabel} className="loading-state-label" />
          {detail && <StableShimmer text={detail} className="loading-detail" />}
        </span>
        <ElapsedTime shimmer />
      </span>
      {surfer && <SurferVideo key={videoSrc} src={videoSrc} />}
    </span>
  );
}
