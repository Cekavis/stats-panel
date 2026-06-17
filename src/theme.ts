import { useEffect, useMemo, useState } from "react";
import type { AppearancePreference, ResolvedAppearance } from "./types";

function getSystemAppearance(): ResolvedAppearance {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useResolvedAppearance(appearance: AppearancePreference) {
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
}
