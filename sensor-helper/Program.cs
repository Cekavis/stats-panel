using System.Diagnostics;
using System.Management;
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

var intervalMs = ParseInterval(args);
var parentPid = ParseParentPid(args);
var dumpSensors = args.Any(arg => string.Equals(arg, "--dump-sensors", StringComparison.OrdinalIgnoreCase));
var computer = new Computer
{
    IsCpuEnabled = true,
    IsGpuEnabled = true,
    IsMotherboardEnabled = true,
    IsControllerEnabled = true,
    IsPowerMonitorEnabled = true,
    IsStorageEnabled = true,
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
    if (dumpSensors)
    {
        computer.Accept(new UpdateVisitor());
        DumpSensors(computer.Hardware);
        return;
    }

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
    var gpuSensors = SelectPrimaryGpuSensors(computer.Hardware);
    var diskSensors = EnumerateDiskSensors(computer.Hardware).ToList();
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

    var cpuFanSpeed = SelectFanSpeed(
        EnumerateBoardFanSensors(computer.Hardware),
        preferredNameNeedles: ["CPU"],
        fallbackToAnyFan: true);

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

    var gpuFanSpeed = SelectAverageFanSpeed(gpuSensors);

    gpuCoreClock ??= ReadWmiSensor(SensorType.Clock, "GPU Core", "GPU Clock", "Core");
    gpuMemoryClock ??= ReadWmiSensor(SensorType.Clock, "GPU Memory", "Memory");
    gpuTemperature ??= ReadWmiSensor(SensorType.Temperature, "GPU", "Core", "Hot Spot", "Junction");
    gpuPower ??= ReadWmiSensor(SensorType.Power, "GPU", "Board", "Total", "Package");

    var diskTemperature = SelectDiskTemperature(diskSensors);

    diskTemperature ??= ReadWmiHardwareSensor(
        SensorType.Temperature,
        ["Storage", "Disk", "Drive", "SSD", "HDD", "NVMe"],
        ["Composite", "Drive", "Temperature"]);

    diskTemperature ??= ReadWindowsStorageReliabilityTemperature();

    var hasAnySensor = cpuFrequency.HasValue
        || cpuTemperature.HasValue
        || cpuPower.HasValue
        || cpuFanSpeed.HasValue
        || gpuCoreClock.HasValue
        || gpuMemoryClock.HasValue
        || gpuTemperature.HasValue
        || gpuPower.HasValue
        || gpuFanSpeed.HasValue
        || diskTemperature.HasValue;
    var missingCpuHardwareSensors = !cpuTemperature.HasValue || !cpuPower.HasValue;
    var sensorDriverState = SensorDriverInfo.GetPawnIoState();
    var sensorDriverInstalled = sensorDriverState == SensorDriverInfo.Installed;
    var sensorDriverRegistered = sensorDriverState == SensorDriverInfo.Registered;
    var message = hasAnySensor
        ? missingCpuHardwareSensors
            ? sensorDriverInstalled
                ? "Bundled sensor helper online. PawnIO is installed, but CPU temperature or power sensors are still unavailable on this hardware."
                : sensorDriverRegistered
                    ? "Bundled sensor helper online. PawnIO was uninstalled, but its driver registration still remains; CPU temperature or power sensors are unavailable."
                : "Bundled sensor helper online. Enable the integrated sensor driver to unlock CPU temperature and power when this hardware requires low-level access."
            : "Bundled sensor helper online."
        : sensorDriverInstalled
            ? "PawnIO is installed, but CPU, GPU, and disk sensors were not found on this hardware."
            : sensorDriverRegistered
                ? "PawnIO was uninstalled, but its driver registration still remains; CPU, GPU, and disk sensors were not found on this hardware."
            : "CPU, GPU, and disk sensors were not found. Enable the integrated sensor driver if this hardware requires low-level access.";

    return new SensorReading(
        true,
        cpuFrequency,
        cpuTemperature,
        cpuPower,
        cpuFanSpeed,
        gpuCoreClock,
        gpuMemoryClock,
        gpuTemperature,
        gpuPower,
        gpuFanSpeed,
        diskTemperature,
        sensorDriverInstalled,
        sensorDriverState,
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

static IEnumerable<ISensor> EnumerateFanSensors(IEnumerable<IHardware> hardwareItems)
{
    foreach (var hardware in hardwareItems)
    {
        foreach (var sensor in hardware.Sensors.Where(sensor => sensor.SensorType == SensorType.Fan))
        {
            yield return sensor;
        }

        foreach (var sensor in EnumerateFanSensors(hardware.SubHardware))
        {
            yield return sensor;
        }
    }
}

static IEnumerable<ISensor> EnumerateBoardFanSensors(IEnumerable<IHardware> hardwareItems, bool isBoardHardware = false)
{
    foreach (var hardware in hardwareItems)
    {
        var nextIsBoardHardware = isBoardHardware
            || hardware.HardwareType == HardwareType.Motherboard
            || ContainsAny(hardware.Name, "Controller", "Super I/O", "SuperIO", "Nuvoton", "ITE");
        if (nextIsBoardHardware)
        {
            foreach (var sensor in hardware.Sensors.Where(sensor => sensor.SensorType == SensorType.Fan))
            {
                yield return sensor;
            }
        }

        foreach (var sensor in EnumerateBoardFanSensors(hardware.SubHardware, nextIsBoardHardware))
        {
            yield return sensor;
        }
    }
}

static List<ISensor> SelectPrimaryGpuSensors(IEnumerable<IHardware> hardwareItems)
{
    return EnumerateGpuHardware(hardwareItems)
        .Select(hardware => new
        {
            Sensors = hardware.Sensors.ToList(),
            Score = ScoreGpuHardware(hardware),
        })
        .OrderByDescending(candidate => candidate.Score)
        .Select(candidate => candidate.Sensors)
        .FirstOrDefault() ?? [];
}

static IEnumerable<IHardware> EnumerateGpuHardware(IEnumerable<IHardware> hardwareItems)
{
    foreach (var hardware in hardwareItems)
    {
        if (hardware.HardwareType is HardwareType.GpuAmd or HardwareType.GpuIntel or HardwareType.GpuNvidia
            || ContainsAny(hardware.Name, "GPU", "NVIDIA", "AMD Radeon", "Intel Graphics"))
        {
            yield return hardware;
        }

        foreach (var gpuHardware in EnumerateGpuHardware(hardware.SubHardware))
        {
            yield return gpuHardware;
        }
    }
}

static IEnumerable<ISensor> EnumerateDiskSensors(IEnumerable<IHardware> hardwareItems)
{
    foreach (var hardware in hardwareItems)
    {
        if (hardware.HardwareType == HardwareType.Storage
            || ContainsAny(hardware.Name, "Storage", "Disk", "Drive", "SSD", "HDD", "NVMe"))
        {
            foreach (var sensor in hardware.Sensors)
            {
                yield return sensor;
            }
        }

        foreach (var sensor in EnumerateDiskSensors(hardware.SubHardware))
        {
            yield return sensor;
        }
    }
}

static double ScoreGpuHardware(IHardware hardware)
{
    var score = hardware.HardwareType == HardwareType.GpuNvidia ? 10_000.0 : 0.0;
    score += hardware.Sensors
        .Where(sensor => sensor.SensorType == SensorType.SmallData && ContainsAny(sensor.Name, "Memory Used"))
        .Select(sensor => (double?)sensor.Value.GetValueOrDefault())
        .DefaultIfEmpty(null)
        .Max() ?? 0.0;

    return score;
}

static double? SelectFanSpeed(
    IEnumerable<ISensor> sensors,
    string[] preferredNameNeedles,
    bool fallbackToAnyFan)
{
    var validFans = sensors
        .Where(sensor => sensor.Value.HasValue && sensor.Value.Value > 0)
        .ToList();
    var preferredValues = validFans
        .Where(sensor => ContainsAny(sensor.Name, preferredNameNeedles))
        .Select(sensor => (double?)sensor.Value!.Value)
        .ToList();

    if (preferredValues.Count > 0)
    {
        return preferredValues.Max();
    }

    if (!fallbackToAnyFan || validFans.Count == 0)
    {
        return null;
    }

    return validFans
        .Select(sensor => (double?)sensor.Value!.Value)
        .DefaultIfEmpty(null)
        .Max();
}

static double? SelectAverageFanSpeed(IEnumerable<ISensor> sensors)
{
    var values = sensors
        .Where(sensor => sensor.SensorType == SensorType.Fan && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Select(sensor => sensor.Value!.Value)
        .ToList();

    return values.Count > 0 ? values.Average() : null;
}

static double? SelectDiskTemperature(IEnumerable<ISensor> sensors)
{
    var currentTemperatures = sensors
        .Where(sensor => sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => IsCurrentTemperatureSensor(sensor.Name))
        .Select(sensor => new SensorValue(sensor.Name, sensor.Value!.Value))
        .ToList();

    return SelectPreferredTemperature(currentTemperatures);
}

static void DumpSensors(IEnumerable<IHardware> hardwareItems, string indent = "")
{
    foreach (var hardware in hardwareItems)
    {
        Console.WriteLine($"{indent}{hardware.HardwareType}: {hardware.Name}");
        foreach (var sensor in hardware.Sensors)
        {
            Console.WriteLine($"{indent}  {sensor.SensorType}: {sensor.Name} = {sensor.Value}");
        }

        DumpSensors(hardware.SubHardware, indent + "  ");
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

static double? ReadWmiHardwareSensor(
    SensorType sensorType,
    string[] hardwareNeedles,
    params string[] sensorNameNeedles)
{
    foreach (var scope in new[] { @"root\LibreHardwareMonitor", @"root\OpenHardwareMonitor" })
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                scope,
                $"SELECT Name, SensorType, Value, Parent, Identifier FROM Sensor WHERE SensorType = '{sensorType}'");

            var values = searcher
                .Get()
                .Cast<ManagementObject>()
                .Select(sensor => new
                {
                    Name = Convert.ToString(sensor["Name"]) ?? "",
                    Parent = Convert.ToString(sensor["Parent"]) ?? "",
                    Identifier = Convert.ToString(sensor["Identifier"]) ?? "",
                    Value = TryReadDouble(sensor["Value"]),
                })
                .Where(sensor => sensor.Value.HasValue && sensor.Value.Value > 0)
                .Where(sensor => ContainsAny(sensor.Name, sensorNameNeedles))
                .Where(sensor => IsCurrentTemperatureSensor(sensor.Name))
                .Where(sensor =>
                    ContainsAny(sensor.Parent, hardwareNeedles)
                    || ContainsAny(sensor.Identifier, hardwareNeedles))
                .Select(sensor => new SensorValue(sensor.Name, sensor.Value!.Value))
                .ToList();

            if (values.Count > 0)
            {
                return SelectPreferredTemperature(values);
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

static double? ReadWindowsStorageReliabilityTemperature()
{
    try
    {
        using var searcher = new ManagementObjectSearcher(
            @"root\Microsoft\Windows\Storage",
            "SELECT Temperature FROM MSFT_StorageReliabilityCounter");

        var values = searcher
            .Get()
            .Cast<ManagementObject>()
            .Select(counter => TryReadDouble(counter["Temperature"]))
            .Where(value => value.HasValue && value.Value > 0)
            .Select(value => value!.Value)
            .ToList();

        return values.Count > 0 ? values.Max() : null;
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

static double? SelectPreferredTemperature(IEnumerable<SensorValue> values)
{
    var candidates = values.ToList();
    foreach (var needles in new[]
             {
                 new[] { "Composite" },
                 new[] { "Drive" },
                 new[] { "Temperature" },
             })
    {
        var matchingValues = candidates
            .Where(sensor => ContainsAny(sensor.Name, needles))
            .Select(sensor => (double?)sensor.Value)
            .ToList();

        if (matchingValues.Count > 0)
        {
            return matchingValues.Max();
        }
    }

    return candidates.Count > 0 ? candidates.Select(sensor => (double?)sensor.Value).Max() : null;
}

static bool IsCurrentTemperatureSensor(string name)
{
    return !ContainsAny(
        name,
        "Critical",
        "Warning",
        "Limit",
        "Threshold",
        "Maximum",
        "Highest",
        "Worst");
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
                var percentPerformance = TryReadDouble(counter["PercentProcessorPerformance"]);
                if (percentPerformance.HasValue && maxClockSpeed.HasValue)
                {
                    return maxClockSpeed.Value * percentPerformance.Value / 100.0;
                }

                return TryReadDouble(counter["ProcessorFrequency"]);
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
    double? CpuFanSpeed,
    double? GpuCoreClock,
    double? GpuMemoryClock,
    double? GpuTemperature,
    double? GpuPower,
    double? GpuFanSpeed,
    double? DiskTemperature,
    bool SensorDriverInstalled,
    string SensorDriverState,
    string Message,
    long Timestamp)
{
    public static SensorReading Unavailable(string message)
    {
        var sensorDriverState = SensorDriverInfo.GetPawnIoState();
        return new SensorReading(
            false,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            sensorDriverState == SensorDriverInfo.Installed,
            sensorDriverState,
            message,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}

internal static class SensorDriverInfo
{
    public const string Installed = "installed";
    public const string Registered = "registered";
    public const string Missing = "missing";

    public static string GetPawnIoState()
    {
        if (HasPawnIoUninstallEntry())
        {
            return Installed;
        }

        return HasPawnIoServiceKey() ? Registered : Missing;
    }

    private static bool HasPawnIoServiceKey()
    {
        using var serviceKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO");
        return serviceKey is not null;
    }

    private static bool HasPawnIoUninstallEntry()
    {
        foreach (var path in new[]
                 {
                     @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                     @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
                 })
        {
            using var uninstallRoot = Registry.LocalMachine.OpenSubKey(path);
            if (uninstallRoot is null)
            {
                continue;
            }

            foreach (var subKeyName in uninstallRoot.GetSubKeyNames())
            {
                using var subKey = uninstallRoot.OpenSubKey(subKeyName);
                if (subKey?.GetValue("DisplayName") is string displayName
                    && displayName.Contains("PawnIO", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return false;
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

internal sealed record SensorValue(string Name, double Value);
