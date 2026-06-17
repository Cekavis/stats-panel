export type MetricGroup = {
  id: string;
  title: string;
  metricIds: string[];
};

export const DASHBOARD_GROUPS: MetricGroup[] = [
  {
    id: "system",
    title: "CPU",
    metricIds: [
      "cpu.usage",
      "cpu.frequency",
      "cpu.temperature",
      "cpu.power",
      "cpu.fan_speed",
    ],
  },
  {
    id: "graphics",
    title: "GPU",
    metricIds: [
      "gpu.usage",
      "gpu.core_clock",
      "gpu.memory_clock",
      "gpu.temperature",
      "gpu.power",
      "gpu.fan_speed",
    ],
  },
  {
    id: "throughput",
    title: "Memory / VRAM / Network / Disk",
    metricIds: [
      "memory.usage",
      "memory.used",
      "gpu.memory_usage",
      "gpu.memory_used",
      "network.download",
      "network.upload",
      "disk.read",
      "disk.write",
      "disk.temperature",
    ],
  },
];
