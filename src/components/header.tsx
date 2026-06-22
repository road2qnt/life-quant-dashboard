"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/analytics", label: "Analytics" },
  { href: "/correlations", label: "Correlations" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/review", label: "Review" },
  { href: "/data", label: "Data" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 24px",
        borderBottom: `1px solid var(--border)`,
        background: "var(--surface)",
      }}
    >
      <strong style={{ color: "var(--text)" }}>Life Quant</strong>
      <nav style={{ display: "flex", gap: 4, flex: 1 }}>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              color: pathname === t.href ? "var(--text)" : "var(--text-muted)",
              textDecoration: "none",
              fontSize: 14,
              background: pathname === t.href ? "var(--surface-2)" : "transparent",
            }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}
