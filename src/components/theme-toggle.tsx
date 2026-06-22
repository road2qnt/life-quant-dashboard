"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span style={{ width: 24 }} />; // avoid hydration mismatch
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
