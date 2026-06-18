type ScorePillProps = { label: string; score: number; tone?: "green" | "gold" | "blue" };

export function ScorePill({ label, score, tone = "gold" }: ScorePillProps) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="kpi" style={{ color: `var(--${tone})` }}>{score}</div>
    </div>
  );
}
