import {
  ChartNoAxesCombined,
  Gauge,
  MonitorCog,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { needsIntegratedSensorDriver } from "../metrics";
import type {
  AppearancePreference,
  MetricDefinition,
  MetricSample,
  ProviderStatus,
  UserPreferences,
} from "../types";
import {
  AppearanceToggle,
  MetricCheckbox,
  RangeControl,
  SwitchControl,
  TooltipButton,
  TooltipProvider,
} from "./ui";

type SettingsViewProps = {
  manifest: MetricDefinition[];
  onAppearanceChange: (value: AppearancePreference) => void;
  onChartHistoryChange: (value: number) => void;
  onCompactChange: (value: boolean) => void;
  onEnableSensorDriver: () => void;
  onIntervalChange: (value: number) => void;
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
};

export function SettingsView({
  manifest,
  onAppearanceChange,
  onChartHistoryChange,
  onCompactChange,
  onEnableSensorDriver,
  onIntervalChange,
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
}: SettingsViewProps) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);
  const needsSensorDriver = needsIntegratedSensorDriver(samples);

  return (
    <TooltipProvider delayDuration={300}>
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

            <AppearanceToggle
              value={preferences.appearance}
              onValueChange={onAppearanceChange}
            />

            <RangeControl
              label="Sampling"
              max={5000}
              min={500}
              step={500}
              suffix="ms"
              value={preferences.sampleIntervalMs}
              onValueChange={onIntervalChange}
            />

            <RangeControl
              label="Chart window"
              max={300}
              min={10}
              step={5}
              suffix="s"
              value={preferences.chartHistorySeconds}
              onValueChange={onChartHistoryChange}
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
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <ChartNoAxesCombined size={18} />
              <h2>Metrics</h2>
            </div>
            <div className="metric-toggle-list">
              {manifest.map((metric) => {
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
            {sensorNote ? <p className="muted-copy">{sensorNote}</p> : null}
          </section>
        </section>
      </main>
    </TooltipProvider>
  );
}
