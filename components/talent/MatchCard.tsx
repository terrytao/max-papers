// Visual primitives for the talent hub: a circular score ring, a
// stacked horizontal breakdown bar (topic/citation/method/venue),
// and reason pills. Kept pure-server-renderable (no client state)
// so the parent page stays a server component.

export function ScoreRing({ score }: { score: number }) {
  // 0-100 → arc from 0 to 2π. Color tiers: ≥80 green, ≥60 amber,
  // <60 grey. Stroke is dasharray on an SVG circle.
  const pct = Math.max(0, Math.min(100, score));
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  const color = pct >= 80 ? "#3b6d11" : pct >= 60 ? "#c8a84b" : "#888";
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" aria-label={`Score ${pct}`}>
      <circle cx={28} cy={28} r={radius} stroke="#eee5cf" strokeWidth={4} fill="none" />
      <circle
        cx={28}
        cy={28}
        r={radius}
        stroke={color}
        strokeWidth={4}
        fill="none"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={circumference / 4}
        transform="rotate(-90 28 28)"
        strokeLinecap="round"
      />
      <text
        x={28}
        y={32}
        textAnchor="middle"
        fontSize={14}
        fontWeight={500}
        fill="#111"
      >
        {pct}
      </text>
    </svg>
  );
}

type Breakdown = {
  topicScore: number;
  citationScore: number;
  methodScore: number;
  venueScore: number;
};

const BREAKDOWN_AXES: Array<{
  key: keyof Breakdown;
  max: number;
  color: string;
  label: string;
}> = [
  { key: "topicScore",    max: 35, color: "#185fa5", label: "Topic" },
  { key: "citationScore", max: 25, color: "#3b6d11", label: "Citations" },
  { key: "methodScore",   max: 15, color: "#c8a84b", label: "Methods" },
  { key: "venueScore",    max: 10, color: "#7c3aed", label: "Venues" },
];

export function BreakdownBar(b: Breakdown) {
  const total = BREAKDOWN_AXES.reduce((s, a) => s + a.max, 0);
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 6,
          border: "0.5px solid #e8e0c8",
          background: "#faf8f5",
          overflow: "hidden",
        }}
      >
        {BREAKDOWN_AXES.map((a) => {
          const pct = (b[a.key] / total) * 100;
          return (
            <div
              key={a.key}
              style={{ width: `${pct}%`, background: a.color }}
              title={`${a.label}: ${b[a.key]}/${a.max}`}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        {BREAKDOWN_AXES.map((a) => (
          <span key={a.key} style={{ fontSize: 10, color: "#888" }}>
            <span style={{ display: "inline-block", width: 7, height: 7, background: a.color, marginRight: 4 }} />
            {a.label} {b[a.key]}/{a.max}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ReasonPills({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {reasons.map((r) => (
        <span
          key={r}
          style={{
            fontSize: 11,
            padding: "3px 9px",
            background: "#f7f4ef",
            border: "0.5px solid #e8e0c8",
            color: "#555",
            lineHeight: 1.5,
          }}
        >
          {r}
        </span>
      ))}
    </div>
  );
}
