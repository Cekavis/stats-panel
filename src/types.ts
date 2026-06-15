export type MetricCategory = "cpu" | "memory" | "gpu" | "network" | "disk";

export type SampleStatus = "ok" | "unavailable" | "error";

export type MetricDefinition = {
  id: string;
  label: string;
  category: MetricCategory;
  unit: string;
  provider: string;
  precision: number;
  supportsChart: boolean;
};

export type MetricSample = {
  id: string;
  value: number | null;
  unit: string;
  status: SampleStatus;
  provider: string;
  timestamp: number;
  message: string | null;
};

export type ProviderStatus = {
  id: string;
  label: string;
  available: boolean;
  message: string;
};

export type TelemetrySnapshot = {
  timestamp: number;
  samples: MetricSample[];
  providers: ProviderStatus[];
};

export type WindowPreferences = {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  alwaysOnTop: boolean;
  compact: boolean;
};

export type UserPreferences = {
  metricSchemaVersion: number;
  launchAtStartup: boolean;
  visibleMetricIds: string[];
  chartMetricIds: string[];
  sampleIntervalMs: number;
  chartHistorySeconds: number;
  window: WindowPreferences;
};
