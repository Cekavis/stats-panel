import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { DashboardView } from "./components/DashboardView";
import { SettingsView } from "./components/SettingsView";
import {
  getMetricsManifest,
  getPreferences,
  installIntegratedSensorDriver,
  requestSensorPermissions,
  savePreferences,
} from "./tauri";
import {
  appendHistory,
  DEFAULT_CHART_HISTORY_SECONDS,
  type History,
} from "./metrics";
import { DEFAULT_THEME_COLORS, useResolvedAppearance } from "./theme";
import {
  checkAndInstallUpdate,
  INITIAL_UPDATE_STATE,
  restartApp,
  type AppUpdateState,
} from "./updates";
import type {
  AppearancePreference,
  MetricDefinition,
  TelemetrySnapshot,
  ThemeColors,
  UserPreferences,
} from "./types";
import "./App.css";

function App() {
  const [manifest, setManifest] = useState<MetricDefinition[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [history, setHistory] = useState<History>({});
  const [sensorNote, setSensorNote] = useState("");
  const [sensorDriverBusy, setSensorDriverBusy] = useState(false);
  const [updateState, setUpdateState] = useState<AppUpdateState>(INITIAL_UPDATE_STATE);
  const [error, setError] = useState("");

  const isSettingsView = new URLSearchParams(window.location.search).get("view") === "settings";

  useResolvedAppearance(
    preferences?.appearance ?? "system",
    preferences?.colors ?? DEFAULT_THEME_COLORS,
  );

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        const [nextManifest, nextPreferences] = await Promise.all([
          getMetricsManifest(),
          getPreferences(),
        ]);

        if (!disposed) {
          setManifest(nextManifest);
          setPreferences(nextPreferences);
        }
      } catch (nextError) {
        if (!disposed) {
          setError(String(nextError));
        }
      }
    }

    boot();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function bind() {
      unlisten = await listen<TelemetrySnapshot>("telemetry-sample", (event) => {
        setSnapshot(event.payload);
        setHistory((current) =>
          appendHistory(
            current,
            event.payload,
            preferences?.chartHistorySeconds ?? DEFAULT_CHART_HISTORY_SECONDS,
          ),
        );
      });
    }

    bind().catch((nextError) => setError(String(nextError)));

    return () => {
      unlisten?.();
    };
  }, [preferences?.chartHistorySeconds]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function bind() {
      unlisten = await listen<UserPreferences>("preferences-updated", (event) => {
        setPreferences(event.payload);
      });
    }

    bind().catch((nextError) => setError(String(nextError)));

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isSettingsView) {
      return;
    }

    let disposed = false;
    checkAndInstallUpdate((nextState) => {
      if (!disposed) {
        setUpdateState(nextState);
      }
    }, { automatic: true });

    return () => {
      disposed = true;
    };
  }, [isSettingsView]);

  const metricById = useMemo(
    () => new Map(manifest.map((metric) => [metric.id, metric])),
    [manifest],
  );

  const sampleById = useMemo(
    () => new Map(snapshot?.samples.map((sample) => [sample.id, sample]) ?? []),
    [snapshot],
  );

  async function persist(nextPreferences: UserPreferences) {
    setPreferences(nextPreferences);
    try {
      const saved = await savePreferences(nextPreferences);
      setPreferences(saved);
    } catch (nextError) {
      setError(String(nextError));
    }
  }

  function toggleVisible(id: string) {
    if (!preferences) {
      return;
    }

    const visible = new Set(preferences.visibleMetricIds);
    const charts = new Set(preferences.chartMetricIds);
    if (visible.has(id)) {
      visible.delete(id);
      charts.delete(id);
    } else {
      visible.add(id);
    }

    persist({
      ...preferences,
      chartMetricIds: Array.from(charts),
      visibleMetricIds: Array.from(visible),
    });
  }

  function toggleChart(id: string) {
    if (!preferences) {
      return;
    }

    const charts = new Set(preferences.chartMetricIds);
    if (charts.has(id)) {
      charts.delete(id);
    } else {
      charts.add(id);
    }

    persist({
      ...preferences,
      chartMetricIds: Array.from(charts),
    });
  }

  function updateAppearance(appearance: AppearancePreference) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, appearance });
  }

  function updateColors(colors: ThemeColors) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, colors });
  }

  function updateInterval(sampleIntervalMs: number) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, sampleIntervalMs });
  }

  function updateChartHistory(chartHistorySeconds: number) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, chartHistorySeconds });
  }

  function updateStartup(launchAtStartup: boolean) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, launchAtStartup });
  }

  function updateWindow<K extends keyof UserPreferences["window"]>(
    key: K,
    value: UserPreferences["window"][K],
  ) {
    if (!preferences) {
      return;
    }
    persist({
      ...preferences,
      window: {
        ...preferences.window,
        [key]: value,
      },
    });
  }

  async function showSensorHelp() {
    setSensorNote(await requestSensorPermissions());
  }

  async function enableSensorDriver() {
    setSensorDriverBusy(true);
    setSensorNote("Starting the integrated sensor driver installer...");
    try {
      setSensorNote(await installIntegratedSensorDriver());
    } catch (nextError) {
      setSensorNote(String(nextError));
    } finally {
      setSensorDriverBusy(false);
    }
  }

  async function checkForUpdates() {
    await checkAndInstallUpdate(setUpdateState);
  }

  async function restartForUpdate() {
    try {
      await restartApp();
    } catch (nextError) {
      setUpdateState((current) => ({
        ...current,
        error: String(nextError),
        message: "Could not restart Stats Panel. Close and reopen it to finish.",
        status: "error",
      }));
    }
  }

  if (error) {
    return (
      <main className={isSettingsView ? "settings-shell is-error" : "dashboard-shell is-error"}>
        <section className="empty-state">
          <Gauge size={30} />
          <h1>Stats Panel</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!preferences) {
    return (
      <main className={isSettingsView ? "settings-shell" : "dashboard-shell"}>
        <section className="empty-state">
          <Activity size={30} />
          <h1>Stats Panel</h1>
          <p>Connecting to the local telemetry service...</p>
        </section>
      </main>
    );
  }

  if (isSettingsView) {
    return (
      <SettingsView
        manifest={manifest}
        preferences={preferences}
        providers={snapshot?.providers ?? []}
        samples={snapshot?.samples ?? []}
        sensorDriverBusy={sensorDriverBusy}
        sensorNote={sensorNote}
        onAppearanceChange={updateAppearance}
        onChartHistoryChange={updateChartHistory}
        onCheckForUpdates={checkForUpdates}
        onColorsChange={updateColors}
        onCompactChange={(compact) => updateWindow("compact", compact)}
        onEnableSensorDriver={enableSensorDriver}
        onIntervalChange={updateInterval}
        onRestartForUpdate={restartForUpdate}
        onSensorHelp={showSensorHelp}
        onStartupChange={updateStartup}
        onToggleChart={toggleChart}
        onToggleVisible={toggleVisible}
        onTopChange={(alwaysOnTop) => updateWindow("alwaysOnTop", alwaysOnTop)}
        updateState={updateState}
      />
    );
  }

  return (
    <DashboardView
      history={history}
      metricById={metricById}
      onEnableSensorDriver={enableSensorDriver}
      preferences={preferences}
      sampleById={sampleById}
      sensorDriverBusy={sensorDriverBusy}
    />
  );
}

export default App;
