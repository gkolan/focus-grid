"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Theme = "light" | "dark";
const KEY = "focusgrid-theme";

/** Two icon buttons; until one is pressed the system preference applies (and shows as pressed). */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function sync() {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* Storage may be unavailable. */ }
      const next = saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light";
      setTheme(next);
      document.documentElement.dataset.theme = next;
    }
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const pick = (next: Theme) => {
    setTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* Keep the choice for this page. */ }
    document.documentElement.dataset.theme = next;
  };
  return (
    <div className="theme-picker" role="group" aria-label="Color theme">
      <button aria-label="Light theme" aria-pressed={theme === "light"} onClick={() => pick("light")}><Icon name="sun" /></button>
      <button aria-label="Dark theme" aria-pressed={theme === "dark"} onClick={() => pick("dark")}><Icon name="moon" /></button>
    </div>
  );
}
