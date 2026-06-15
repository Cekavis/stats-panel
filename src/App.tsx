import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChartNoAxesCombined,
  Check,
  Gauge,
  MonitorCog,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  getMetricsManifest,
  getPreferences,
  installIntegratedSensorDriver,
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

const DEFAULT_CHART_HISTORY_SECONDS = 60;

type HistoryPoint = {
  timestamp: number;
  value: number;
};

type History = Record<string, HistoryPoint[]>;

type CpuCoreUsage = {
  index: number;
  value: number;
};

type MetricGroup = {
  id: string;
  title: string;
  metricIds: string[];
};

const DASHBOARD_GROUPS: MetricGroup[] = [
  {
    id: "system",
    title: "CPU / Memory",
    metricIds: [
      "cpu.usage",
      "cpu.frequency",
      "cpu.temperature",
      "cpu.power",
      "cpu.fan_speed",
      "memory.usage",
      "memory.used",
    ],
  },
  {
    id: "graphics",
    title: "GPU / VRAM",
    metricIds: [
      "gpu.usage",
      "gpu.core_clock",
      "gpu.memory_clock",
      "gpu.temperature",
      "gpu.power",
      "gpu.fan_speed",
      "gpu.memory_usage",
      "gpu.memory_used",
    ],
  },
  {
    id: "throughput",
    title: "Network / Disk",
    metricIds: ["network.download", "network.upload", "disk.read", "disk.write", "disk.temperature"],
  },
];

function App() {
  const [manifest, setManifest] = useState<MetricDefinition[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [history, setHistory] = useState<History>({});
  const [sensorNote, setSensorNote] = useState("");
  const [sensorDriverBusy, setSensorDriverBusy] = useState(false);
  const [error, setError] = useState("");

  const isSettingsView = new URLSearchParams(window.location.search).get("view") === "settings";

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
          appendHistory(current, event.payload, preferences?.chartHistorySeconds ?? DEFAULT_CHART_HISTORY_SECONDS),
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
        onCompactChange={(compact) => updateWindow("compact", compact)}
        onChartHistoryChange={updateChartHistory}
        onEnableSensorDriver={enableSensorDriver}
        onIntervalChange={updateInterval}
        onSensorHelp={showSensorHelp}
        onStartupChange={updateStartup}
        onToggleChart={toggleChart}
        onToggleVisible={toggleVisible}
        onTopChange={(alwaysOnTop) => updateWindow("alwaysOnTop", alwaysOnTop)}
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

function DashboardView({
  history,
  metricById,
  onEnableSensorDriver,
  preferences,
  sampleById,
  sensorDriverBusy,
}: {
  history: History;
  metricById: Map<string, MetricDefinition>;
  onEnableSensorDriver: () => void;
  preferences: UserPreferences;
  sampleById: Map<string, MetricSample>;
  sensorDriverBusy: boolean;
}) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);
  const now = Math.max(...Object.values(history).flat().map((point) => point.timestamp), Date.now());
  const needsSensorDriver = needsIntegratedSensorDriver(Array.from(sampleById.values()));
  const cpuCoreUsages = getCpuCoreUsages(sampleById);

  return (
    <main
      className={`dashboard-shell ${preferences.window.compact ? "is-compact" : ""}`}
      data-tauri-drag-region
    >
      {needsSensorDriver ? (
        <section className="sensor-driver-callout">
          <ShieldCheck size={17} />
          <span>CPU temperature and power need the integrated sensor driver.</span>
          <button disabled={sensorDriverBusy} type="button" onClick={onEnableSensorDriver}>
            {sensorDriverBusy ? "Opening..." : "Enable"}
          </button>
        </section>
      ) : null}
      <section className="dashboard-grid" aria-label="Stats dashboard" data-tauri-drag-region>
        {DASHBOARD_GROUPS.map((group) => (
          <section className="metric-group" key={group.id} data-tauri-drag-region>
            <h2 data-tauri-drag-region>{group.title}</h2>
            <div className="metric-list" data-tauri-drag-region>
              {group.metricIds
                .filter((id) => {
                  const pairedId = pairedMetricId(id);
                  if (pairedId) {
                    return visible.has(id) || visible.has(pairedId);
                  }
                  return visible.has(id);
                })
                .map((id) => {
                  if (id === "memory.used" || id === "gpu.memory_used") {
                    return null;
                  }

                  const metric = metricById.get(id);
                  if (!metric) {
                    return null;
                  }

                  if (id === "cpu.usage") {
                    return (
                      <CpuUsageMetricRow
                        key={metric.id}
                        coreUsages={cpuCoreUsages}
                        metric={metric}
                        now={now}
                        points={history[metric.id] ?? []}
                        seconds={preferences.chartHistorySeconds}
                        sample={sampleById.get(metric.id)}
                        showChart={charted.has(metric.id)}
                      />
                    );
                  }

                  if (id === "memory.usage") {
                    return (
                      <CombinedMetricRow
                        key={metric.id}
                        chartMetric={metric}
                        label="Memory"
                        now={now}
                        points={history[metric.id] ?? []}
                        seconds={preferences.chartHistorySeconds}
                        showChart={charted.has(metric.id)}
                        usageSample={sampleById.get("memory.usage")}
                        usedMetric={metricById.get("memory.used")}
                        usedSample={sampleById.get("memory.used")}
                      />
                    );
                  }

                  if (id === "gpu.memory_usage") {
                    return (
                      <CombinedMetricRow
                        key={metric.id}
                        chartMetric={metric}
                        label="VRAM"
                        now={now}
                        points={history[metric.id] ?? []}
                        seconds={preferences.chartHistorySeconds}
                        showChart={charted.has(metric.id)}
                        usageSample={sampleById.get("gpu.memory_usage")}
                        usedMetric={metricById.get("gpu.memory_used")}
                        usedSample={sampleById.get("gpu.memory_used")}
                      />
                    );
                  }

                  return (
                    <MetricRow
                      key={metric.id}
                      metric={metric}
                      now={now}
                      points={history[metric.id] ?? []}
                      seconds={preferences.chartHistorySeconds}
                      sample={sampleById.get(metric.id)}
                      showChart={charted.has(metric.id)}
                    />
                  );
                })}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}

function CombinedMetricRow({
  chartMetric,
  label,
  now,
  points,
  seconds,
  showChart,
  usageSample,
  usedMetric,
  usedSample,
}: {
  chartMetric: MetricDefinition;
  label: string;
  now: number;
  points: HistoryPoint[];
  seconds: number;
  showChart: boolean;
  usageSample: MetricSample | undefined;
  usedMetric: MetricDefinition | undefined;
  usedSample: MetricSample | undefined;
}) {
  return (
    <article className={`metric-row metric-row-${chartMetric.category}`} data-tauri-drag-region>
      <div className="metric-value" data-tauri-drag-region>
        <span data-tauri-drag-region>{label}</span>
        <div className="paired-values" data-tauri-drag-region>
          <strong className={usageSample?.status === "ok" ? "" : "is-muted"} data-tauri-drag-region>
            {usageSample ? formatSample(usageSample, chartMetric) : "--"}
          </strong>
          <em className={usedSample?.status === "ok" ? "" : "is-muted"} data-tauri-drag-region>
            {usedSample && usedMetric ? formatSample(usedSample, usedMetric) : "--"}
          </em>
        </div>
      </div>
      <AxisChart metric={chartMetric} now={now} points={showChart ? points : []} seconds={seconds} />
    </article>
  );
}

function pairedMetricId(id: string) {
  if (id === "memory.usage") {
    return "memory.used";
  }

  if (id === "gpu.memory_usage") {
    return "gpu.memory_used";
  }

  return "";
}

function needsIntegratedSensorDriver(samples: MetricSample[]) {
  const cpuTemperature = samples.find((sample) => sample.id === "cpu.temperature");
  const cpuPower = samples.find((sample) => sample.id === "cpu.power");

  return [cpuTemperature, cpuPower].some((sample) =>
    sample?.status === "unavailable" && sample.message?.includes("integrated sensor driver"),
  );
}

function CpuUsageMetricRow({
  coreUsages,
  metric,
  now,
  points,
  seconds,
  sample,
  showChart,
}: {
  coreUsages: CpuCoreUsage[];
  metric: MetricDefinition;
  now: number;
  points: HistoryPoint[];
  seconds: number;
  sample: MetricSample | undefined;
  showChart: boolean;
}) {
  return (
    <article className="metric-row metric-row-cpu metric-row-cpu-usage" data-tauri-drag-region>
      <div className="metric-row-main" data-tauri-drag-region>
        <div className="metric-value" data-tauri-drag-region>
          <span data-tauri-drag-region>{metric.label}</span>
          <strong className={sample?.status === "ok" ? "" : "is-muted"} data-tauri-drag-region>
            {sample ? formatSample(sample, metric) : "--"}
          </strong>
        </div>
        <AxisChart metric={metric} now={now} points={showChart ? points : []} seconds={seconds} />
      </div>
      <CpuCoreBars coreUsages={coreUsages} />
    </article>
  );
}

function CpuCoreBars({ coreUsages }: { coreUsages: CpuCoreUsage[] }) {
  return (
    <div
      className={`cpu-core-bars ${coreUsages.length === 0 ? "is-empty" : ""}`}
      aria-label="CPU per-core usage"
      data-tauri-drag-region
    >
      {coreUsages.map((core) => (
        <div className="cpu-core-bar-slot" key={core.index} title={`Core ${core.index + 1}: ${Math.round(core.value)}%`}>
          <span
            className="cpu-core-bar"
            style={{ height: `${clampPercent(core.value)}%` }}
            data-tauri-drag-region
          />
        </div>
      ))}
    </div>
  );
}

function MetricRow({
  metric,
  now,
  points,
  seconds,
  sample,
  showChart,
}: {
  metric: MetricDefinition;
  now: number;
  points: HistoryPoint[];
  seconds: number;
  sample: MetricSample | undefined;
  showChart: boolean;
}) {
  return (
    <article className={`metric-row metric-row-${metric.category}`} data-tauri-drag-region>
      <div className="metric-value" data-tauri-drag-region>
        <span data-tauri-drag-region>{metric.label}</span>
        <strong className={sample?.status === "ok" ? "" : "is-muted"} data-tauri-drag-region>
          {sample ? formatSample(sample, metric) : "--"}
        </strong>
      </div>
      <AxisChart metric={metric} now={now} points={showChart ? points : []} seconds={seconds} />
    </article>
  );
}

function AxisChart({
  metric,
  now,
  points,
  seconds,
}: {
  metric: MetricDefinition;
  now: number;
  points: HistoryPoint[];
  seconds: number;
}) {
  const domain = getChartDomain(metric, points);
  const path = buildPath(points, now, domain, seconds * 1000);
  const topLabel = formatAxisValue(domain.max, metric);
  const bottomLabel = formatAxisValue(domain.min, metric);
  const durationLabel = formatDurationLabel(seconds);

  return (
    <svg className="axis-chart" viewBox="0 0 260 92" role="img" aria-label={`${metric.label} ${durationLabel} trend`}>
      <path className="chart-axis" d="M38 12V68H246" />
      <path className="chart-gridline" d="M38 12H246" />
      <path className="chart-gridline" d="M38 40H246" />
      <path className="chart-gridline" d="M38 68H246" />
      <text className="axis-label axis-y-top" x="4" y="15">
        {topLabel}
      </text>
      <text className="axis-label axis-y-bottom" x="4" y="71">
        {bottomLabel}
      </text>
      <text className="axis-label axis-x-left" x="38" y="85">
        {durationLabel}
      </text>
      <text className="axis-label axis-x-right" x="225" y="85">
        now
      </text>
      {path ? <path className={`chart-line category-${metric.category}`} d={path} /> : null}
    </svg>
  );
}

function SettingsView({
  manifest,
  preferences,
  providers,
  samples,
  sensorDriverBusy,
  sensorNote,
  onCompactChange,
  onChartHistoryChange,
  onEnableSensorDriver,
  onIntervalChange,
  onSensorHelp,
  onStartupChange,
  onToggleChart,
  onToggleVisible,
  onTopChange,
}: {
  manifest: MetricDefinition[];
  preferences: UserPreferences;
  providers: ProviderStatus[];
  samples: MetricSample[];
  sensorDriverBusy: boolean;
  sensorNote: string;
  onCompactChange: (value: boolean) => void;
  onChartHistoryChange: (value: number) => void;
  onEnableSensorDriver: () => void;
  onIntervalChange: (value: number) => void;
  onSensorHelp: () => void;
  onStartupChange: (value: boolean) => void;
  onToggleChart: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onTopChange: (value: boolean) => void;
}) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);
  const needsSensorDriver = needsIntegratedSensorDriver(samples);

  return (
    <main className="settings-shell">
      <header className="settings-titlebar" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1>Stats Panel Settings</h1>
          <span>Display, sampling, and data sources</span>
        </div>
        <SlidersHorizontal size={21} />
      </header>

      <section className="settings-content">
        <section className="settings-section">
          <div className="settings-section-heading">
            <Gauge size={18} />
            <h2>Panel</h2>
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

          <label className="range-control">
            <span>Chart window</span>
            <strong>{preferences.chartHistorySeconds} s</strong>
            <input
              max="300"
              min="10"
              step="5"
              type="range"
              value={preferences.chartHistorySeconds}
              onChange={(event) => onChartHistoryChange(Number(event.currentTarget.value))}
            />
          </label>

          <label className="switch-row">
            <span>Compact rows</span>
            <input
              checked={preferences.window.compact}
              type="checkbox"
              onChange={(event) => onCompactChange(event.currentTarget.checked)}
            />
          </label>

          <label className="switch-row">
            <span>Always on top</span>
            <input
              checked={preferences.window.alwaysOnTop}
              type="checkbox"
              onChange={(event) => onTopChange(event.currentTarget.checked)}
            />
          </label>

          <label className="switch-row">
            <span>Launch at Windows startup</span>
            <input
              checked={preferences.launchAtStartup}
              type="checkbox"
              onChange={(event) => onStartupChange(event.currentTarget.checked)}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <ChartNoAxesCombined size={18} />
            <h2>Metrics</h2>
          </div>
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
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <MonitorCog size={18} />
            <h2>Data Sources</h2>
          </div>
          <div className="provider-list">
            {needsSensorDriver ? (
              <div className="sensor-driver-notice">
                <ShieldCheck size={16} />
                <span>CPU temperature and power need the integrated sensor driver.</span>
              </div>
            ) : null}
            {providers.length === 0 ? (
              <p className="muted-copy">Waiting for telemetry providers...</p>
            ) : (
              providers.map((provider) => (
                <div className="provider-row" key={provider.id}>
                  <span className={provider.available ? "status-pill is-online" : "status-pill"}>
                    {provider.available ? "Online" : "Offline"}
                  </span>
                  <div>
                    <strong>{provider.label}</strong>
                    <p>{provider.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="sensor-actions">
            <button className="text-button" type="button" onClick={onSensorHelp}>
              Sensor access
            </button>
            <button
              className="text-button"
              disabled={sensorDriverBusy}
              type="button"
              onClick={onEnableSensorDriver}
            >
              {sensorDriverBusy ? "Opening installer..." : "Enable integrated sensor driver"}
            </button>
          </div>
          {sensorNote && <p className="muted-copy">{sensorNote}</p>}
        </section>
      </section>
    </main>
  );
}

function getCpuCoreUsages(sampleById: Map<string, MetricSample>): CpuCoreUsage[] {
  const corePattern = /^cpu\.core\.(\d+)\.usage$/;

  return Array.from(sampleById.values())
    .flatMap((sample) => {
      const match = corePattern.exec(sample.id);
      if (!match || sample.status !== "ok" || sample.value === null) {
        return [];
      }

      return [{ index: Number(match[1]), value: clampPercent(sample.value) }];
    })
    .sort((left, right) => left.index - right.index);
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function appendHistory(
  current: History,
  snapshot: TelemetrySnapshot,
  chartHistorySeconds: number,
): History {
  const next: History = { ...current };
  const historyMs = chartHistorySeconds * 1000;
  const minTimestamp = snapshot.timestamp - historyMs;
  const latestSamples = new Map<string, MetricSample>();

  for (const sample of snapshot.samples) {
    if (sample.status !== "ok" || sample.value === null) {
      continue;
    }

    latestSamples.set(sample.id, sample);
  }

  for (const sample of latestSamples.values()) {
    if (sample.value === null) {
      continue;
    }

    const points = next[sample.id] ? [...next[sample.id]] : [];
    points.push({ timestamp: snapshot.timestamp, value: sample.value });
    next[sample.id] = points.filter((point) => point.timestamp >= minTimestamp);
  }

  return next;
}

function buildPath(
  points: HistoryPoint[],
  now: number,
  domain: { min: number; max: number },
  historyMs: number,
) {
  if (points.length < 2) {
    return "";
  }

  const plot = {
    x: 38,
    y: 12,
    width: 208,
    height: 56,
  };
  const minTime = now - historyMs;
  const valueSpan = Math.max(domain.max - domain.min, 1);

  return points
    .filter((point) => point.timestamp >= minTime)
    .map((point, index) => {
      const x = plot.x + ((point.timestamp - minTime) / historyMs) * plot.width;
      const clampedValue = Math.min(Math.max(point.value, domain.min), domain.max);
      const y = plot.y + plot.height - ((clampedValue - domain.min) / valueSpan) * plot.height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatDurationLabel(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }

  return `${seconds}s`;
}

function getChartDomain(metric: MetricDefinition, points: HistoryPoint[]) {
  if (metric.unit === "%") {
    return { min: 0, max: 100 };
  }

  const maxPoint = Math.max(0, ...points.map((point) => point.value));
  const max = maxPoint > 0 ? maxPoint * 1.15 : 1;
  return { min: 0, max };
}

function formatSample(sample: MetricSample, metric: MetricDefinition) {
  if (sample.status !== "ok" || sample.value === null) {
    return "--";
  }

  if (sample.unit === "B/s") {
    return formatBytes(sample.value) + "/s";
  }

  const precision = metric.id === "gpu.usage" ? 0 : metric.precision;
  return `${sample.value.toFixed(precision)} ${formatUnit(sample.unit)}`;
}

function formatAxisValue(value: number, metric: MetricDefinition) {
  if (metric.unit === "B/s") {
    return formatBytes(value) + "/s";
  }

  if (metric.unit === "%") {
    return `${Math.round(value)}%`;
  }

  return `${value.toFixed(metric.precision === 0 ? 0 : 1)} ${formatUnit(metric.unit)}`;
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

function formatUnit(unit: string) {
  return unit === "C" ? "℃" : unit;
}

export default App;
