export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ color: accent ?? "var(--text)", fontSize: 28, marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
