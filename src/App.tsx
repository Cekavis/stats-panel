import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChartNoAxesCombined,
  Check,
  Gauge,
  MonitorCog,
  Pin,
  Settings,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  getMetricsManifest,
  getPreferences,
  requestSensorPermissions,
  savePreferences,
} from "./tauri";
import type {
  MetricDefinition,
  MetricSample,
  ProviderStatus,
  TelemetrySnapshot,
  UserPreferences,
} from "./types";
import "./App.css";

const HISTORY_MS = 5 * 60 * 1000;

type HistoryPoint = {
  timestamp: number;
  value: number;
};

type History = Record<string, HistoryPoint[]>;

const CATEGORY_LABELS = {
  cpu: "CPU",
  memory: "Memory",
  gpu: "GPU",
  network: "Network",
  disk: "Disk",
};

function App() {
  const [manifest, setManifest] = useState<MetricDefinition[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [history, setHistory] = useState<History>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensorNote, setSensorNote] = useState("");
  const [error, setError] = useState("");

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
        setHistory((current) => appendHistory(current, event.payload));
      });
    }

    bind().catch((nextError) => setError(String(nextError)));

    return () => {
      unlisten?.();
    };
  }, []);

  const metricById = useMemo(
    () => new Map(manifest.map((metric) => [metric.id, metric])),
    [manifest],
  );

  const sampleById = useMemo(
    () => new Map(snapshot?.samples.map((sample) => [sample.id, sample]) ?? []),
    [snapshot],
  );

  const visibleMetrics = useMemo(() => {
    if (!preferences) {
      return [];
    }
    return preferences.visibleMetricIds
      .map((id) => metricById.get(id))
      .filter((metric): metric is MetricDefinition => Boolean(metric));
  }, [metricById, preferences]);

  const chartMetrics = useMemo(() => {
    if (!preferences) {
      return [];
    }
    return preferences.chartMetricIds
      .map((id) => metricById.get(id))
      .filter((metric): metric is MetricDefinition => Boolean(metric));
  }, [metricById, preferences]);

  const primarySamples = useMemo(() => {
    const ids = ["cpu.usage", "gpu.usage", "memory.usage", "network.download"];
    return ids.map((id) => sampleById.get(id)).filter(Boolean) as MetricSample[];
  }, [sampleById]);

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
      visibleMetricIds: Array.from(visible),
      chartMetricIds: Array.from(charts),
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

  function updateInterval(sampleIntervalMs: number) {
    if (!preferences) {
      return;
    }
    persist({ ...preferences, sampleIntervalMs });
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

  if (error) {
    return (
      <main className="app-shell is-error">
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
      <main className="app-shell">
        <section className="empty-state">
          <Activity size={30} />
          <h1>Stats Panel</h1>
          <p>Connecting to the local telemetry service...</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${preferences.window.compact ? "is-compact" : ""}`}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="title-lockup" data-tauri-drag-region>
          <Gauge size={21} />
          <div data-tauri-drag-region>
            <h1>Stats Panel</h1>
            <span>{snapshot ? formatTime(snapshot.timestamp) : "Waiting for telemetry"}</span>
          </div>
        </div>
        <div className="title-actions">
          <button
            className={preferences.window.alwaysOnTop ? "icon-button is-active" : "icon-button"}
            title="Always on top"
            type="button"
            onClick={() => updateWindow("alwaysOnTop", !preferences.window.alwaysOnTop)}
          >
            <Pin size={17} />
          </button>
          <button
            className={settingsOpen ? "icon-button is-active" : "icon-button"}
            title="Settings"
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <section className="summary-strip">
        {primarySamples.map((sample) => {
          const metric = metricById.get(sample.id);
          if (!metric) {
            return null;
          }
          return (
            <div className="summary-item" key={sample.id}>
              <span>{metric.label}</span>
              <strong>{formatSample(sample, metric)}</strong>
            </div>
          );
        })}
      </section>

      <section className="content-layout">
        <section className="dashboard-pane">
          <MetricGrid metrics={visibleMetrics} samples={sampleById} />
          <ChartPanel metrics={chartMetrics} samples={sampleById} history={history} />
          <ProviderPanel
            providers={snapshot?.providers ?? []}
            sensorNote={sensorNote}
            onSensorHelp={showSensorHelp}
          />
        </section>

        {settingsOpen && (
          <SettingsDrawer
            manifest={manifest}
            preferences={preferences}
            onClose={() => setSettingsOpen(false)}
            onToggleVisible={toggleVisible}
            onToggleChart={toggleChart}
            onIntervalChange={updateInterval}
            onCompactChange={(compact) => updateWindow("compact", compact)}
          />
        )}
      </section>
    </main>
  );
}

function MetricGrid({
  metrics,
  samples,
}: {
  metrics: MetricDefinition[];
  samples: Map<string, MetricSample>;
}) {
  return (
    <section className="metric-grid" aria-label="Metric cards">
      {metrics.map((metric) => {
        const sample = samples.get(metric.id);
        return (
          <article className="metric-card" key={metric.id}>
            <div className="metric-card-top">
              <span className={`category-dot category-${metric.category}`} />
              <span>{CATEGORY_LABELS[metric.category]}</span>
            </div>
            <h2>{metric.label}</h2>
            <strong className={sample?.status === "ok" ? "" : "is-muted"}>
              {sample ? formatSample(sample, metric) : "--"}
            </strong>
            <p title={sample?.message ?? metric.provider}>
              {sample?.status === "ok" ? metric.provider : sample?.message ?? "Waiting"}
            </p>
          </article>
        );
      })}
    </section>
  );
}

function ChartPanel({
  metrics,
  samples,
  history,
}: {
  metrics: MetricDefinition[];
  samples: Map<string, MetricSample>;
  history: History;
}) {
  return (
    <section className="chart-panel" aria-label="Line charts">
      <div className="section-heading">
        <ChartNoAxesCombined size={18} />
        <h2>Trends</h2>
      </div>
      {metrics.length === 0 ? (
        <p className="muted-copy">No chart metrics selected.</p>
      ) : (
        <div className="chart-stack">
          {metrics.map((metric) => (
            <MiniChart
              key={metric.id}
              metric={metric}
              sample={samples.get(metric.id)}
              points={history[metric.id] ?? []}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MiniChart({
  metric,
  sample,
  points,
}: {
  metric: MetricDefinition;
  sample: MetricSample | undefined;
  points: HistoryPoint[];
}) {
  const path = buildPath(points);

  return (
    <article className="mini-chart">
      <div className="mini-chart-meta">
        <span>{metric.label}</span>
        <strong>{sample ? formatSample(sample, metric) : "--"}</strong>
      </div>
      <svg viewBox="0 0 240 64" role="img" aria-label={`${metric.label} trend`}>
        <path className="chart-gridline" d="M0 48H240" />
        <path className="chart-gridline" d="M0 24H240" />
        {path ? <path className={`chart-line category-${metric.category}`} d={path} /> : null}
      </svg>
    </article>
  );
}

function ProviderPanel({
  providers,
  sensorNote,
  onSensorHelp,
}: {
  providers: ProviderStatus[];
  sensorNote: string;
  onSensorHelp: () => void;
}) {
  return (
    <section className="provider-panel">
      <div className="section-heading">
        <MonitorCog size={18} />
        <h2>Providers</h2>
      </div>
      <div className="provider-list">
        {providers.map((provider) => (
          <div className="provider-row" key={provider.id}>
            <span className={provider.available ? "status-pill is-online" : "status-pill"}>
              {provider.available ? "Online" : "Offline"}
            </span>
            <div>
              <strong>{provider.label}</strong>
              <p>{provider.message}</p>
            </div>
          </div>
        ))}
      </div>
      <button className="text-button" type="button" onClick={onSensorHelp}>
        Sensor access
      </button>
      {sensorNote && <p className="muted-copy">{sensorNote}</p>}
    </section>
  );
}

function SettingsDrawer({
  manifest,
  preferences,
  onClose,
  onToggleVisible,
  onToggleChart,
  onIntervalChange,
  onCompactChange,
}: {
  manifest: MetricDefinition[];
  preferences: UserPreferences;
  onClose: () => void;
  onToggleVisible: (id: string) => void;
  onToggleChart: (id: string) => void;
  onIntervalChange: (value: number) => void;
  onCompactChange: (value: boolean) => void;
}) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);

  return (
    <aside className="settings-drawer">
      <div className="settings-heading">
        <h2>Customize</h2>
        <button className="icon-button" title="Close settings" type="button" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <label className="range-control">
        <span>Sampling</span>
        <strong>{preferences.sampleIntervalMs} ms</strong>
        <input
          max="5000"
          min="500"
          step="500"
          type="range"
          value={preferences.sampleIntervalMs}
          onChange={(event) => onIntervalChange(Number(event.currentTarget.value))}
        />
      </label>

      <label className="switch-row">
        <span>Compact cards</span>
        <input
          checked={preferences.window.compact}
          type="checkbox"
          onChange={(event) => onCompactChange(event.currentTarget.checked)}
        />
      </label>

      <div className="metric-toggle-list">
        {manifest.map((metric) => (
          <div className="metric-toggle-row" key={metric.id}>
            <button
              className={visible.has(metric.id) ? "toggle-button is-on" : "toggle-button"}
              type="button"
              title={`Show ${metric.label}`}
              onClick={() => onToggleVisible(metric.id)}
            >
              {visible.has(metric.id) ? <Check size={14} /> : null}
            </button>
            <span>{metric.label}</span>
            <button
              className={charted.has(metric.id) ? "chart-toggle is-on" : "chart-toggle"}
              disabled={!visible.has(metric.id)}
              type="button"
              title={`Chart ${metric.label}`}
              onClick={() => onToggleChart(metric.id)}
            >
              <ChartNoAxesCombined size={15} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function appendHistory(current: History, snapshot: TelemetrySnapshot): History {
  const next: History = { ...current };
  const minTimestamp = snapshot.timestamp - HISTORY_MS;

  for (const sample of snapshot.samples) {
    if (sample.status !== "ok" || sample.value === null) {
      continue;
    }

    const points = next[sample.id] ? [...next[sample.id]] : [];
    points.push({ timestamp: snapshot.timestamp, value: sample.value });
    next[sample.id] = points.filter((point) => point.timestamp >= minTimestamp);
  }

  return next;
}

function buildPath(points: HistoryPoint[]) {
  if (points.length < 2) {
    return "";
  }

  const width = 240;
  const height = 64;
  const minTime = points[0].timestamp;
  const maxTime = points[points.length - 1].timestamp;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = Math.max(maxValue - minValue, 1);
  const timeSpan = Math.max(maxTime - minTime, 1);

  return points
    .map((point, index) => {
      const x = ((point.timestamp - minTime) / timeSpan) * width;
      const y = height - ((point.value - minValue) / valueSpan) * (height - 10) - 5;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatSample(sample: MetricSample, metric: MetricDefinition) {
  if (sample.status !== "ok" || sample.value === null) {
    return "--";
  }

  if (sample.unit === "B/s") {
    return formatBytes(sample.value) + "/s";
  }

  return `${sample.value.toFixed(metric.precision)} ${sample.unit}`;
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export default App;
