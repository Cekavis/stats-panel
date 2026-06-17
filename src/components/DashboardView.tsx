import { ShieldCheck } from "lucide-react";
import { DASHBOARD_GROUPS } from "../dashboardGroups";
import {
  buildPath,
  clampPercent,
  formatAxisValue,
  formatDurationLabel,
  formatSample,
  getChartDomain,
  getCpuCoreUsages,
  needsIntegratedSensorDriver,
  pairedMetricId,
} from "../metrics";
import type { CpuCoreUsage, History, HistoryPoint } from "../metrics";
import type { MetricDefinition, MetricSample, UserPreferences } from "../types";

type DashboardViewProps = {
  history: History;
  metricById: Map<string, MetricDefinition>;
  onEnableSensorDriver: () => void;
  preferences: UserPreferences;
  sampleById: Map<string, MetricSample>;
  sensorDriverBusy: boolean;
};

export function DashboardView({
  history,
  metricById,
  onEnableSensorDriver,
  preferences,
  sampleById,
  sensorDriverBusy,
}: DashboardViewProps) {
  const visible = new Set(preferences.visibleMetricIds);
  const charted = new Set(preferences.chartMetricIds);
  const now = Math.max(
    ...Object.values(history)
      .flat()
      .map((point) => point.timestamp),
    Date.now(),
  );
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
                  return pairedId ? visible.has(id) || visible.has(pairedId) : visible.has(id);
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
                        coreUsages={cpuCoreUsages}
                        key={metric.id}
                        metric={metric}
                        now={now}
                        points={history[metric.id] ?? []}
                        sample={sampleById.get(metric.id)}
                        seconds={preferences.chartHistorySeconds}
                        showChart={charted.has(metric.id)}
                      />
                    );
                  }

                  if (id === "memory.usage") {
                    return (
                      <CombinedMetricRow
                        chartMetric={metric}
                        key={metric.id}
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
                        chartMetric={metric}
                        key={metric.id}
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
                      sample={sampleById.get(metric.id)}
                      seconds={preferences.chartHistorySeconds}
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
          <strong
            className={usageSample?.status === "ok" ? "" : "is-muted"}
            data-tauri-drag-region
          >
            {usageSample ? formatSample(usageSample, chartMetric) : "--"}
          </strong>
          <em
            className={usedSample?.status === "ok" ? "" : "is-muted"}
            data-tauri-drag-region
          >
            {usedSample && usedMetric ? formatSample(usedSample, usedMetric) : "--"}
          </em>
        </div>
      </div>
      <AxisChart metric={chartMetric} now={now} points={showChart ? points : []} seconds={seconds} />
    </article>
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
      aria-label="CPU per-core usage"
      className={`cpu-core-bars ${coreUsages.length === 0 ? "is-empty" : ""}`}
      data-tauri-drag-region
    >
      {coreUsages.map((core) => (
        <div
          className="cpu-core-bar-slot"
          key={core.index}
          title={`Core ${core.index + 1}: ${Math.round(core.value)}%`}
        >
          <span
            className="cpu-core-bar"
            data-tauri-drag-region
            style={{ height: `${clampPercent(core.value)}%` }}
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
    <svg
      aria-label={`${metric.label} ${durationLabel} trend`}
      className="axis-chart"
      role="img"
      viewBox="0 0 260 92"
    >
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
