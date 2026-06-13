using System.Diagnostics;
using System.Management;
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;

var intervalMs = ParseInterval(args);
var parentPid = ParseParentPid(args);
var computer = new Computer
{
    IsCpuEnabled = true,
    IsGpuEnabled = true,
    IsMotherboardEnabled = true,
    IsControllerEnabled = true,
    IsPowerMonitorEnabled = true,
};

try
{
    computer.Open();
}
catch (Exception error)
{
    WriteReading(SensorReading.Unavailable(error.Message));
    return;
}

try
{
    var once = args.Any(arg => string.Equals(arg, "--once", StringComparison.OrdinalIgnoreCase));

    do
    {
        if (ParentProcessExited(parentPid))
        {
            break;
        }

        try
        {
            computer.Accept(new UpdateVisitor());
            WriteReading(ReadSensors(computer));
        }
        catch (Exception error)
        {
            WriteReading(SensorReading.Unavailable(error.Message));
        }

        if (!once)
        {
            Thread.Sleep(intervalMs);
        }
    }
    while (!once);
}
finally
{
    computer.Close();
}

static int ParseInterval(string[] args)
{
    const int defaultInterval = 1000;
    var intervalArg = args.FirstOrDefault(arg => arg.StartsWith("--interval=", StringComparison.OrdinalIgnoreCase));
    if (intervalArg is null)
    {
        return defaultInterval;
    }

    var rawValue = intervalArg.Split('=', 2)[1];
    return int.TryParse(rawValue, out var value) ? Math.Clamp(value, 500, 5000) : defaultInterval;
}

static int? ParseParentPid(string[] args)
{
    var parentArg = args.FirstOrDefault(arg => arg.StartsWith("--parent-pid=", StringComparison.OrdinalIgnoreCase));
    if (parentArg is null)
    {
        return null;
    }

    var rawValue = parentArg.Split('=', 2)[1];
    return int.TryParse(rawValue, out var value) && value > 0 ? value : null;
}

static bool ParentProcessExited(int? parentPid)
{
    if (!parentPid.HasValue)
    {
        return false;
    }

    try
    {
        return Process.GetProcessById(parentPid.Value).HasExited;
    }
    catch (ArgumentException)
    {
        return true;
    }
    catch (InvalidOperationException)
    {
        return true;
    }
}

static SensorReading ReadSensors(Computer computer)
{
    var sensors = EnumerateCpuSensors(computer.Hardware).ToList();
    var gpuSensors = EnumerateGpuSensors(computer.Hardware).ToList();
    var cpuFrequency = sensors
        .Where(sensor => sensor.SensorType == SensorType.Clock && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => !ContainsAny(sensor.Name, "Bus", "BCLK"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Average();

    var cpuTemperature = sensors
        .Where(sensor => sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "CPU", "Package", "Tctl", "Tdie", "Core Max", "Core Average"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    var cpuPower = sensors
        .Where(sensor => sensor.SensorType == SensorType.Power && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "CPU", "Package", "Cores", "Core", "PPT"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    cpuFrequency ??= ReadCpuFrequencyFromWindowsPerformanceCounters();
    cpuTemperature ??= ReadWmiSensor(SensorType.Temperature, "CPU", "Package", "Tctl", "Tdie", "Core Max", "Core Average");
    cpuPower ??= ReadWmiSensor(SensorType.Power, "CPU", "Package", "Cores", "Core", "PPT");

    var gpuCoreClock = gpuSensors
        .Where(sensor => sensor.SensorType == SensorType.Clock && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "Core", "Graphics", "GPU"))
        .Where(sensor => !ContainsAny(sensor.Name, "Memory", "Shader", "Video"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    var gpuMemoryClock = gpuSensors
        .Where(sensor => sensor.SensorType == SensorType.Clock && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "Memory", "VRAM"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    var gpuTemperature = gpuSensors
        .Where(sensor => sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "GPU", "Core", "Hot Spot", "Junction"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    var gpuPower = gpuSensors
        .Where(sensor => sensor.SensorType == SensorType.Power && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "GPU", "Board", "Total", "Package"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();

    gpuCoreClock ??= ReadWmiSensor(SensorType.Clock, "GPU Core", "GPU Clock", "Core");
    gpuMemoryClock ??= ReadWmiSensor(SensorType.Clock, "GPU Memory", "Memory");
    gpuTemperature ??= ReadWmiSensor(SensorType.Temperature, "GPU", "Core", "Hot Spot", "Junction");
    gpuPower ??= ReadWmiSensor(SensorType.Power, "GPU", "Board", "Total", "Package");

    var message = cpuFrequency.HasValue
        || cpuTemperature.HasValue
        || cpuPower.HasValue
        || gpuCoreClock.HasValue
        || gpuMemoryClock.HasValue
        || gpuTemperature.HasValue
        || gpuPower.HasValue
        ? "Bundled sensor helper online."
        : "CPU and GPU sensors were not found.";

    return new SensorReading(
        true,
        cpuFrequency,
        cpuTemperature,
        cpuPower,
        gpuCoreClock,
        gpuMemoryClock,
        gpuTemperature,
        gpuPower,
        message,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
}

static IEnumerable<ISensor> EnumerateCpuSensors(IEnumerable<IHardware> hardwareItems)
{
    foreach (var hardware in hardwareItems)
    {
        if (hardware.HardwareType == HardwareType.Cpu || ContainsAny(hardware.Name, "CPU", "Processor"))
        {
            foreach (var sensor in hardware.Sensors)
            {
                yield return sensor;
            }
        }

        foreach (var sensor in EnumerateCpuSensors(hardware.SubHardware))
        {
            yield return sensor;
        }
    }
}

static IEnumerable<ISensor> EnumerateGpuSensors(IEnumerable<IHardware> hardwareItems)
{
    foreach (var hardware in hardwareItems)
    {
        if (hardware.HardwareType is HardwareType.GpuAmd or HardwareType.GpuIntel or HardwareType.GpuNvidia
            || ContainsAny(hardware.Name, "GPU", "NVIDIA", "AMD Radeon", "Intel Graphics"))
        {
            foreach (var sensor in hardware.Sensors)
            {
                yield return sensor;
            }
        }

        foreach (var sensor in EnumerateGpuSensors(hardware.SubHardware))
        {
            yield return sensor;
        }
    }
}

static double? ReadWmiSensor(SensorType sensorType, params string[] nameNeedles)
{
    foreach (var scope in new[] { @"root\LibreHardwareMonitor", @"root\OpenHardwareMonitor" })
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                scope,
                $"SELECT Name, SensorType, Value FROM Sensor WHERE SensorType = '{sensorType}'");

            var values = searcher
                .Get()
                .Cast<ManagementObject>()
                .Select(sensor => new
                {
                    Name = Convert.ToString(sensor["Name"]) ?? "",
                    Value = TryReadDouble(sensor["Value"]),
                })
                .Where(sensor => sensor.Value.HasValue && sensor.Value.Value > 0)
                .Where(sensor => ContainsAny(sensor.Name, nameNeedles))
                .Select(sensor => sensor.Value)
                .ToList();

            if (values.Count > 0)
            {
                return values.Max();
            }
        }
        catch (ManagementException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    return null;
}

static double? ReadCpuFrequencyFromWindowsPerformanceCounters()
{
    try
    {
        var maxClockSpeed = ReadMaxCpuClockSpeed();
        using var searcher = new ManagementObjectSearcher(
            @"root\CIMV2",
            "SELECT Name, PercentProcessorPerformance, ProcessorFrequency FROM Win32_PerfFormattedData_Counters_ProcessorInformation");

        var values = searcher
            .Get()
            .Cast<ManagementObject>()
            .Where(counter => !string.Equals(Convert.ToString(counter["Name"]), "_Total", StringComparison.OrdinalIgnoreCase))
            .Select(counter =>
            {
                var frequency = TryReadDouble(counter["ProcessorFrequency"]);
                if (frequency.HasValue)
                {
                    return frequency;
                }

                var percentPerformance = TryReadDouble(counter["PercentProcessorPerformance"]);
                return percentPerformance.HasValue && maxClockSpeed.HasValue
                    ? maxClockSpeed.Value * percentPerformance.Value / 100.0
                    : null;
            })
            .Where(value => value.HasValue && value.Value > 0)
            .Select(value => value!.Value)
            .ToList();

        return values.Count > 0 ? values.Average() : null;
    }
    catch (ManagementException)
    {
        return null;
    }
    catch (UnauthorizedAccessException)
    {
        return null;
    }
}

static double? ReadMaxCpuClockSpeed()
{
    try
    {
        using var searcher = new ManagementObjectSearcher(@"root\CIMV2", "SELECT MaxClockSpeed FROM Win32_Processor");
        var values = searcher
            .Get()
            .Cast<ManagementObject>()
            .Select(processor => TryReadDouble(processor["MaxClockSpeed"]))
            .Where(value => value.HasValue && value.Value > 0)
            .Select(value => value!.Value)
            .ToList();

        return values.Count > 0 ? values.Average() : null;
    }
    catch (ManagementException)
    {
        return null;
    }
    catch (UnauthorizedAccessException)
    {
        return null;
    }
}

static double? TryReadDouble(object? value)
{
    if (value is null)
    {
        return null;
    }

    try
    {
        return Convert.ToDouble(value);
    }
    catch (FormatException)
    {
        return null;
    }
    catch (InvalidCastException)
    {
        return null;
    }
}

static bool ContainsAny(string value, params string[] needles)
{
    return needles.Any(needle => value.Contains(needle, StringComparison.OrdinalIgnoreCase));
}

static void WriteReading(SensorReading reading)
{
    Console.WriteLine(JsonSerializer.Serialize(reading, SensorJsonContext.Default.SensorReading));
    Console.Out.Flush();
}

internal sealed record SensorReading(
    bool Available,
    double? CpuFrequency,
    double? CpuTemperature,
    double? CpuPower,
    double? GpuCoreClock,
    double? GpuMemoryClock,
    double? GpuTemperature,
    double? GpuPower,
    string Message,
    long Timestamp)
{
    public static SensorReading Unavailable(string message)
    {
        return new SensorReading(false, null, null, null, null, null, null, null, message, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}

internal sealed class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer)
    {
        computer.Traverse(this);
    }

    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (var subHardware in hardware.SubHardware)
        {
            subHardware.Accept(this);
        }
    }

    public void VisitSensor(ISensor sensor)
    {
    }

    public void VisitParameter(IParameter parameter)
    {
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SensorReading))]
internal sealed partial class SensorJsonContext : JsonSerializerContext
{
}
