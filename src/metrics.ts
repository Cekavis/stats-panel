import type { MetricDefinition, MetricSample, TelemetrySnapshot } from "./types";

export const DEFAULT_CHART_HISTORY_SECONDS = 60;

export type HistoryPoint = {
  timestamp: number;
  value: number;
};

export type History = Record<string, HistoryPoint[]>;

export type CpuCoreUsage = {
  index: number;
  value: number;
};

const CHART_PLOT = {
  x: 12,
  y: 18,
  width: 238,
  height: 60,
};

export function pairedMetricId(id: string) {
  if (id === "memory.usage") {
    return "memory.used";
  }

  if (id === "gpu.memory_usage") {
    return "gpu.memory_used";
  }

  return "";
}

export function needsIntegratedSensorDriver(samples: MetricSample[]) {
  const cpuTemperature = samples.find((sample) => sample.id === "cpu.temperature");
  const cpuPower = samples.find((sample) => sample.id === "cpu.power");

  return [cpuTemperature, cpuPower].some(
    (sample) =>
      sample?.status === "unavailable" &&
      sample.message?.includes("integrated sensor driver"),
  );
}

export function getCpuCoreUsages(sampleById: Map<string, MetricSample>): CpuCoreUsage[] {
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

export function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

export function appendHistory(
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

export function buildPath(
  points: HistoryPoint[],
  now: number,
  domain: { min: number; max: number },
  historyMs: number,
) {
  const plotPoints = buildPlotPoints(points, now, domain, historyMs);
  if (plotPoints.length < 2) {
    return "";
  }

  return plotPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

export function buildAreaPath(
  points: HistoryPoint[],
  now: number,
  domain: { min: number; max: number },
  historyMs: number,
) {
  const plotPoints = buildPlotPoints(points, now, domain, historyMs);
  if (plotPoints.length < 2) {
    return "";
  }

  const baseline = CHART_PLOT.y + CHART_PLOT.height;
  const firstPoint = plotPoints[0];
  const lastPoint = plotPoints[plotPoints.length - 1];
  const line = plotPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");

  return `${line} L${lastPoint.x} ${baseline} L${firstPoint.x} ${baseline} Z`;
}

function buildPlotPoints(
  points: HistoryPoint[],
  now: number,
  domain: { min: number; max: number },
  historyMs: number,
) {
  const minTime = now - historyMs;
  const valueSpan = Math.max(domain.max - domain.min, 1);

  return points
    .filter((point) => point.timestamp >= minTime)
    .map((point) => {
      const x = CHART_PLOT.x + ((point.timestamp - minTime) / historyMs) * CHART_PLOT.width;
      const clampedValue = Math.min(Math.max(point.value, domain.min), domain.max);
      const y =
        CHART_PLOT.y +
        CHART_PLOT.height -
        ((clampedValue - domain.min) / valueSpan) * CHART_PLOT.height;
      return { x: x.toFixed(1), y: y.toFixed(1) };
    });
}

export function formatDurationLabel(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }

  return `${seconds}s`;
}

export function getChartDomain(metric: MetricDefinition, points: HistoryPoint[]) {
  if (metric.unit === "%") {
    return { min: 0, max: 100 };
  }

  const maxPoint = Math.max(0, ...points.map((point) => point.value));
  const max = maxPoint > 0 ? maxPoint * 1.15 : 1;
  return { min: 0, max };
}

export function formatSample(sample: MetricSample, metric: MetricDefinition) {
  if (sample.status !== "ok" || sample.value === null) {
    return "--";
  }

  if (sample.unit === "B/s") {
    return formatBytes(sample.value) + "/s";
  }

  const precision = metric.id === "gpu.usage" ? 0 : metric.precision;
  return `${sample.value.toFixed(precision)} ${formatUnit(sample.unit)}`;
}

export function formatAxisValue(value: number, metric: MetricDefinition) {
  if (metric.unit === "B/s") {
    return formatBytes(value) + "/s";
  }

  if (metric.unit === "%") {
    return `${Math.round(value)}%`;
  }

  return `${value.toFixed(metric.precision === 0 ? 0 : 1)} ${formatUnit(metric.unit)}`;
}

export function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(unitIndex === 0 || scaled >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUnit(unit: string) {
  return unit === "C" ? "°C" : unit;
}
