export type MetricGroup = {
  id: string;
  title: string;
  metricIds: string[];
};

export const DASHBOARD_GROUPS: MetricGroup[] = [
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
    metricIds: [
      "network.download",
      "network.upload",
      "disk.read",
      "disk.write",
      "disk.temperature",
    ],
  },
];
