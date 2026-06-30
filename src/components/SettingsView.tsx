import {
  ChartNoAxesCombined,
  Gauge,
  MonitorCog,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Tabs } from "radix-ui";
import { DASHBOARD_GROUPS } from "../dashboardGroups";
import { needsIntegratedSensorDriver } from "../metrics";
import { DEFAULT_THEME_COLORS } from "../theme";
import type { AppUpdateState } from "../updates";
import type {
  AppearancePreference,
  MetricDefinition,
  MetricSample,
  ProviderStatus,
  ThemeColors,
  UserPreferences,
} from "../types";
import {
  AppearanceToggle,
  MetricCheckbox,
  SegmentedNumberControl,
  SwitchControl,
  TooltipButton,
  TooltipProvider,
} from "./ui";

type SettingsViewProps = {
  manifest: MetricDefinition[];
  onAppearanceChange: (value: AppearancePreference) => void;
  onChartHistoryChange: (value: number) => void;
  onCheckForUpdates: () => void;
  onColorsChange: (value: ThemeColors) => void;
  onCompactChange: (value: boolean) => void;
  onEnableSensorDriver: () => void;
  onIntervalChange: (value: number) => void;
  onRestartForUpdate: () => void;
  onSensorHelp: () => void;
  onStartupChange: (value: boolean) => void;
  onToggleChart: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onTopChange: (value: boolean) => void;
  preferences: UserPreferences;
  providers: ProviderStatus[];
  samples: MetricSample[];
  sensorDriverBusy: boolean;
  sensorNote: string;
  updateState: AppUpdateState;
};

const SAMPLING_PRESETS = [
  { label: "500 ms", value: 500 },
  { label: "1 s", value: 1000 },
  { label: "2 s", value: 2000 },
  { label: "5 s", value: 5000 },
];

const CHART_WINDOW_PRESETS = [
  { label: "30 s", value: 30 },
  { label: "1 m", value: 60 },
  { label: "2 m", value: 120 },
  { label: "5 m", value: 300 },
];

const COLOR_CONTROLS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU" },
  { key: "memory", label: "Memory" },
  { key: "network", label: "Network" },
  { key: "disk", label: "Disk" },
  { key: "lightCardBackground", label: "Light card" },
];

export function SettingsView({
  manifest,
  onAppearanceChange,
  onChartHistoryChange,
  onCheckForUpdates,
  onColorsChange,
  onCompactChange,
  onEnableSensorDriver,
  onIntervalChange,
  onRestartForUpdate,
  onSensorHelp,
  onStartupChange,
  onToggleChart,
  onToggleVisible,
  onTopChange,
  preferences,
  providers,
  samples,
  sensorDriverBusy,
  sensorNote,
  updateState,
}: SettingsViewProps) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);
  const needsSensorDriver = needsIntegratedSensorDriver(samples);
  const metricsByGroup = getSettingsMetricGroups(manifest);
  const updateBusy = ["checking", "downloading", "installing"].includes(updateState.status);
  const updateLabel = getUpdateLabel(updateState);
  const updateClassName = getUpdatePillClassName(updateState);

  return (
    <TooltipProvider delayDuration={300}>
      <main className="settings-shell">
        <header className="settings-titlebar" data-tauri-drag-region>
          <div data-tauri-drag-region>
            <h1>Stats Panel Settings</h1>
            <span>Display, colors, sampling, and data sources</span>
          </div>
          <SlidersHorizontal size={21} />
        </header>

        <Tabs.Root className="settings-tabs" defaultValue="panel">
          <Tabs.List aria-label="Settings sections" className="settings-tab-list">
            <Tabs.Trigger className="settings-tab-trigger" value="panel">
              <Gauge size={15} />
              <span>Panel</span>
            </Tabs.Trigger>
            <Tabs.Trigger className="settings-tab-trigger" value="metrics">
              <ChartNoAxesCombined size={15} />
              <span>Metrics</span>
            </Tabs.Trigger>
            <Tabs.Trigger className="settings-tab-trigger" value="colors">
              <Palette size={15} />
              <span>Colors</span>
            </Tabs.Trigger>
            <Tabs.Trigger className="settings-tab-trigger" value="sources">
              <MonitorCog size={15} />
              <span>Data Sources</span>
            </Tabs.Trigger>
          </Tabs.List>

          <section className="settings-content">
            <Tabs.Content className="settings-tab-panel" value="panel">
              <section className="settings-section">
                <div className="settings-section-heading">
                  <Gauge size={18} />
                  <h2>Panel</h2>
                </div>

                <div className="settings-subsection">
                  <AppearanceToggle
                    value={preferences.appearance}
                    onValueChange={onAppearanceChange}
                  />
                  <SwitchControl
                    checked={preferences.window.compact}
                    label="Compact rows"
                    onCheckedChange={onCompactChange}
                  />
                  <SwitchControl
                    checked={preferences.window.alwaysOnTop}
                    label="Always on top"
                    onCheckedChange={onTopChange}
                  />
                  <SwitchControl
                    checked={preferences.launchAtStartup}
                    label="Launch at Windows startup"
                    onCheckedChange={onStartupChange}
                  />
                </div>

                <div className="settings-subsection">
                  <SegmentedNumberControl
                    label="Sampling"
                    max={5000}
                    min={500}
                    presets={SAMPLING_PRESETS}
                    step={500}
                    suffix="ms"
                    value={preferences.sampleIntervalMs}
                    onValueChange={onIntervalChange}
                  />

                  <SegmentedNumberControl
                    label="Chart window"
                    max={300}
                    min={10}
                    presets={CHART_WINDOW_PRESETS}
                    step={5}
                    suffix="s"
                    value={preferences.chartHistorySeconds}
                    onValueChange={onChartHistoryChange}
                  />
                </div>

                <div className="settings-subsection">
                  <div className="update-row">
                    <span className={updateClassName}>{updateLabel}</span>
                    <div className="update-copy">
                      <strong>Updates</strong>
                      <p>{updateState.message}</p>
                      {updateState.error ? <p>{updateState.error}</p> : null}
                    </div>
                  </div>
                  {updateState.progress !== undefined ? (
                    <div
                      aria-label={`Update progress ${updateState.progress}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={updateState.progress}
                      className="update-progress"
                      role="progressbar"
                    >
                      <span style={{ width: `${updateState.progress}%` }} />
                    </div>
                  ) : null}
                  <div className="update-actions">
                    <button
                      className="text-button"
                      disabled={updateBusy}
                      type="button"
                      onClick={onCheckForUpdates}
                    >
                      <RefreshCw size={14} />
                      <span>{updateBusy ? "Working..." : "Check for updates"}</span>
                    </button>
                    {updateState.status === "installed" ? (
                      <button className="text-button" type="button" onClick={onRestartForUpdate}>
                        <Power size={14} />
                        <span>Restart to finish</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            </Tabs.Content>

            <Tabs.Content className="settings-tab-panel" value="metrics">
              <section className="settings-section">
                <div className="settings-section-heading">
                  <ChartNoAxesCombined size={18} />
                  <h2>Metrics</h2>
                </div>
                <div className="settings-metric-groups">
                  {metricsByGroup.map((group) => (
                    <section className="settings-metric-group" key={group.id}>
                      <div className="settings-metric-group-heading">
                        <h3>{group.title}</h3>
                        <span>
                          {group.metrics.filter((metric) => visible.has(metric.id)).length} shown
                        </span>
                      </div>
                      <div className="metric-toggle-list">
                        {group.metrics.map((metric) => {
                          const isVisible = visible.has(metric.id);
                          const isCharted = charted.has(metric.id);
                          const chartDisabled = !isVisible || !metric.supportsChart;

                          return (
                            <div className="metric-toggle-row" key={metric.id}>
                              <MetricCheckbox
                                checked={isVisible}
                                label={`Show ${metric.label}`}
                                onCheckedChange={() => onToggleVisible(metric.id)}
                              />
                              <span>{metric.label}</span>
                              <TooltipButton
                                className={isCharted ? "chart-toggle is-on" : "chart-toggle"}
                                disabled={chartDisabled}
                                label={`Chart ${metric.label}`}
                                pressed={isCharted}
                                onClick={() => onToggleChart(metric.id)}
                              >
                                <ChartNoAxesCombined size={15} />
                              </TooltipButton>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </Tabs.Content>

            <Tabs.Content className="settings-tab-panel" value="colors">
              <section className="settings-section">
                <div className="settings-section-heading">
                  <Palette size={18} />
                  <h2>Colors</h2>
                </div>

                <div className="color-control-list">
                  {COLOR_CONTROLS.map((control) => (
                    <ColorControl
                      key={control.key}
                      label={control.label}
                      value={preferences.colors[control.key]}
                      onValueChange={(value) =>
                        onColorsChange({ ...preferences.colors, [control.key]: value })
                      }
                    />
                  ))}
                </div>

                <div className="settings-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => onColorsChange(DEFAULT_THEME_COLORS)}
                  >
                    <RotateCcw size={14} />
                    <span>Reset colors</span>
                  </button>
                </div>
              </section>
            </Tabs.Content>

            <Tabs.Content className="settings-tab-panel" value="sources">
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
                        <span
                          className={provider.available ? "status-pill is-online" : "status-pill"}
                        >
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
                {sensorNote ? <p className="muted-copy">{sensorNote}</p> : null}
              </section>
            </Tabs.Content>
          </section>
        </Tabs.Root>
      </main>
    </TooltipProvider>
  );
}

function ColorControl({
  label,
  onValueChange,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="color-control-row">
      <span>{label}</span>
      <span className="color-picker-field">
        <input
          aria-label={`${label} color`}
          className="color-picker-input"
          type="color"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
        <em>{value}</em>
      </span>
    </label>
  );
}

function getUpdateLabel(updateState: AppUpdateState) {
  switch (updateState.status) {
    case "checking":
      return "Checking";
    case "downloading":
      return "Download";
    case "installing":
      return "Install";
    case "installed":
      return "Ready";
    case "upToDate":
      return "Current";
    case "error":
      return "Retry";
    case "idle":
    default:
      return "Idle";
  }
}

function getUpdatePillClassName(updateState: AppUpdateState) {
  if (updateState.status === "upToDate" || updateState.status === "installed") {
    return "status-pill is-online";
  }

  if (updateState.status === "checking" || updateState.status === "downloading") {
    return "status-pill is-busy";
  }

  if (updateState.status === "installing") {
    return "status-pill is-warning";
  }

  return "status-pill";
}

function getSettingsMetricGroups(manifest: MetricDefinition[]) {
  const manifestById = new Map(manifest.map((metric) => [metric.id, metric]));
  const groupedIds = new Set<string>();
  const groups = DASHBOARD_GROUPS.map((group) => {
    const metrics = group.metricIds.flatMap((id) => {
      const metric = manifestById.get(id);
      if (!metric) {
        return [];
      }
      groupedIds.add(id);
      return [metric];
    });

    return {
      id: group.id,
      metrics,
      title: group.title,
    };
  }).filter((group) => group.metrics.length > 0);

  const remainingMetrics = manifest.filter((metric) => !groupedIds.has(metric.id));
  if (remainingMetrics.length > 0) {
    groups.push({
      id: "other",
      metrics: remainingMetrics,
      title: "Other",
    });
  }

  return groups;
}
