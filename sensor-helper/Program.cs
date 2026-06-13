using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;

var intervalMs = ParseInterval(args);
var computer = new Computer
{
    IsCpuEnabled = true,
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
        try
        {
            computer.Accept(new UpdateVisitor());
            WriteReading(ReadCpuSensors(computer));
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

static SensorReading ReadCpuSensors(Computer computer)
{
    var sensors = EnumerateCpuSensors(computer.Hardware).ToList();
    var cpuTemperature = sensors
        .Where(sensor => sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "CPU", "Package", "Tctl", "Tdie", "Core Max", "Core Average"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .Max();

    var cpuPower = sensors
        .Where(sensor => sensor.SensorType == SensorType.Power && sensor.Value.HasValue)
        .Where(sensor => sensor.Value!.Value > 0)
        .Where(sensor => ContainsAny(sensor.Name, "CPU", "Package", "Cores", "Core", "PPT"))
        .Select(sensor => (double?)sensor.Value!.Value)
        .Max();

    var message = cpuTemperature.HasValue || cpuPower.HasValue
        ? "Bundled sensor helper online."
        : "CPU temperature and power sensors were not found.";

    return new SensorReading(true, cpuTemperature, cpuPower, message, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
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
    double? CpuTemperature,
    double? CpuPower,
    string Message,
    long Timestamp)
{
    public static SensorReading Unavailable(string message)
    {
        return new SensorReading(false, null, null, message, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
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
