import { useEffect, useMemo, useState } from "react";
import type { AppearancePreference, ResolvedAppearance, ThemeColors } from "./types";

export const DEFAULT_THEME_COLORS: ThemeColors = {
  cpu: "#ed1c24",
  memory: "#f59e0b",
  gpu: "#76b900",
  network: "#0ea5e9",
  disk: "#8b5cf6",
  lightCardBackground: "#ffffff",
};

const ACCENT_COLOR_KEYS: Array<Exclude<keyof ThemeColors, "lightCardBackground">> = [
  "cpu",
  "memory",
  "gpu",
  "network",
  "disk",
];

function getSystemAppearance(): ResolvedAppearance {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useResolvedAppearance(
  appearance: AppearancePreference,
  colors: ThemeColors = DEFAULT_THEME_COLORS,
) {
  const [systemAppearance, setSystemAppearance] = useState<ResolvedAppearance>(() =>
    getSystemAppearance(),
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemAppearance = (event: MediaQueryListEvent) => {
      setSystemAppearance(event.matches ? "dark" : "light");
    };

    setSystemAppearance(media.matches ? "dark" : "light");
    media.addEventListener("change", updateSystemAppearance);

    return () => {
      media.removeEventListener("change", updateSystemAppearance);
    };
  }, []);

  const resolvedAppearance = useMemo<ResolvedAppearance>(
    () => (appearance === "system" ? systemAppearance : appearance),
    [appearance, systemAppearance],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedAppearance;
    document.documentElement.style.colorScheme = resolvedAppearance;
  }, [resolvedAppearance]);

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const softMix = resolvedAppearance === "dark" ? 24 : 14;

    for (const key of ACCENT_COLOR_KEYS) {
      rootStyle.setProperty(`--accent-${key}`, colors[key]);
      rootStyle.setProperty(
        `--accent-${key}-soft`,
        `color-mix(in srgb, ${colors[key]} ${softMix}%, var(--color-card-background))`,
      );
    }

    if (resolvedAppearance === "light") {
      rootStyle.setProperty("--color-card-background", colors.lightCardBackground);
    } else {
      rootStyle.removeProperty("--color-card-background");
    }
  }, [colors, resolvedAppearance]);
}
