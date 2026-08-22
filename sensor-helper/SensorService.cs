using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;

internal static class SensorServiceHost
{
    public const string ServiceName = "StatsPanelSensor";

    public static void Run(Func<Computer> createComputer, Func<Computer, SensorReading> readSensors)
    {
        ServiceBase.Run(new SensorWindowsService(createComputer, readSensors));
    }

    private sealed class SensorWindowsService : ServiceBase
    {
        private readonly Func<Computer> _createComputer;
        private readonly Func<Computer, SensorReading> _readSensors;
        private CancellationTokenSource? _stopping;
        private Task? _worker;

        public SensorWindowsService(Func<Computer> createComputer, Func<Computer, SensorReading> readSensors)
        {
            _createComputer = createComputer;
            _readSensors = readSensors;
            ServiceName = SensorServiceHost.ServiceName;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            _stopping = new CancellationTokenSource();
            _worker = Task.Run(() => RunAsync(_stopping.Token));
        }

        protected override void OnStop()
        {
            StopWorker();
        }

        protected override void OnShutdown()
        {
            StopWorker();
            base.OnShutdown();
        }

        private async Task RunAsync(CancellationToken cancellationToken)
        {
            SensorReading latest = SensorReading.Unavailable(
                "Sensor broker is starting.",
                SensorBrokerModes.Service,
                SensorHealthStates.ModuleLoadFailed);
            var pipeServer = new SensorPipeServer(() => Volatile.Read(ref latest));
            var pipeTask = RunPipeWithRetryAsync(pipeServer, cancellationToken);
            Computer? computer = null;

            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    var repair = PawnIoRepair.TryRepairIfNeeded(SensorDriverInfo.ProbePawnIoDevice());
                    if (repair.Attempted)
                    {
                        CloseComputer(ref computer);
                        Volatile.Write(
                            ref latest,
                            SensorReading.Unavailable(
                                repair.Message,
                                SensorBrokerModes.Service,
                                repair.RebootRequired
                                    ? SensorHealthStates.RebootRequired
                                    : SensorHealthStates.NotFound).WithRepair(repair));
                        await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
                        continue;
                    }

                    try
                    {
                        if (computer is null)
                        {
                            computer = _createComputer();
                            computer.Open();
                        }

                        computer.Accept(new UpdateVisitor());
                        Volatile.Write(ref latest, _readSensors(computer).WithRepair(repair));
                    }
                    catch (Exception error) when (error is not OperationCanceledException)
                    {
                        CloseComputer(ref computer);
                        Volatile.Write(
                            ref latest,
                            SensorReading.Unavailable(
                                error.Message,
                                SensorBrokerModes.Service,
                                SensorHealthStates.ModuleLoadFailed).WithRepair(repair));
                    }

                    await Task.Delay(computer is null ? TimeSpan.FromSeconds(5) : TimeSpan.FromSeconds(1), cancellationToken)
                        .ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
            finally
            {
                CloseComputer(ref computer);
                await pipeTask.ConfigureAwait(false);
            }
        }

        private void StopWorker()
        {
            _stopping?.Cancel();
            try
            {
                _worker?.Wait(TimeSpan.FromSeconds(10));
            }
            catch (AggregateException error) when (error.InnerExceptions.All(inner => inner is OperationCanceledException))
            {
            }
            finally
            {
                _stopping?.Dispose();
                _stopping = null;
                _worker = null;
            }
        }

        private static void CloseComputer(ref Computer? computer)
        {
            if (computer is null)
            {
                return;
            }

            computer.Close();
            computer = null;
        }

        private static async Task RunPipeWithRetryAsync(
            SensorPipeServer pipeServer,
            CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await pipeServer.RunAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        return;
                    }
                }
            }
        }
    }
}

internal static class SensorServiceRegistration
{
    private const int ErrorAccessDenied = 5;
    private const int ErrorServiceAlreadyRunning = 1056;
    private const int ErrorServiceDoesNotExist = 1060;
    private const int ErrorServiceNotActive = 1062;
    private const int ErrorServiceExists = 1073;
    private const string ServiceExecutableName = "stats-sensor-helper.exe";

    public static int Install()
    {
        var executable = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executable)
            || !IsProtectedServiceExecutable(executable))
        {
            return ErrorAccessDenied;
        }

        var stop = Stop();
        if (stop != 0)
        {
            return stop;
        }

        var imagePath = $"\"{Path.GetFullPath(executable)}\" --service";
        var create = RunSc(
            "create",
            SensorServiceHost.ServiceName,
            "binPath=",
            imagePath,
            "start=",
            "delayed-auto",
            "obj=",
            "LocalSystem",
            "DisplayName=",
            "Stats Panel Sensor");
        if (create is not (0 or ErrorServiceExists))
        {
            return create;
        }

        var commands = new[]
        {
            new[]
            {
                "config",
                SensorServiceHost.ServiceName,
                "binPath=",
                imagePath,
                "start=",
                "delayed-auto",
                "obj=",
                "LocalSystem",
                "DisplayName=",
                "Stats Panel Sensor",
            },
            new[]
            {
                "failure",
                SensorServiceHost.ServiceName,
                "reset=",
                "86400",
                "actions=",
                "restart/5000/restart/10000/restart/30000",
            },
            new[]
            {
                "failureflag",
                SensorServiceHost.ServiceName,
                "1",
            },
        };

        foreach (var command in commands)
        {
            var exitCode = RunSc(command);
            if (exitCode != 0)
            {
                return exitCode;
            }
        }

        var start = RunSc("start", SensorServiceHost.ServiceName);
        return start is 0 or ErrorServiceAlreadyRunning ? 0 : start;
    }

    public static int Stop()
    {
        var stop = RunSc("stop", SensorServiceHost.ServiceName);
        if (stop is ErrorServiceDoesNotExist or ErrorServiceNotActive)
        {
            return 0;
        }

        if (stop != 0)
        {
            return stop;
        }

        try
        {
            using var controller = new ServiceController(SensorServiceHost.ServiceName);
            controller.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
            return 0;
        }
        catch (InvalidOperationException)
        {
            return 0;
        }
        catch (System.ServiceProcess.TimeoutException)
        {
            return 1460;
        }
    }

    public static int Uninstall()
    {
        var stop = Stop();
        if (stop != 0)
        {
            return stop;
        }

        var delete = RunSc("delete", SensorServiceHost.ServiceName);
        return delete == ErrorServiceDoesNotExist ? 0 : delete;
    }

    private static int RunSc(params string[] arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "sc.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
            Arguments = string.Join(" ", arguments.Select(QuoteScArgument)),
        };

        try
        {
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return 2;
            }

            if (!process.WaitForExit(30_000))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (InvalidOperationException)
                {
                }

                return 1460;
            }

            return process.ExitCode;
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            return error.NativeErrorCode == 0 ? 2 : error.NativeErrorCode;
        }
    }

    private static string QuoteScArgument(string argument)
    {
        if (!argument.Contains(' ') && !argument.Contains('"'))
        {
            return argument;
        }

        return $"\"{argument.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }

    private static bool IsProtectedServiceExecutable(string path)
    {
        try
        {
            var fullPath = Path.GetFullPath(path);
            if (!File.Exists(fullPath)
                || !string.Equals(Path.GetFileName(fullPath), ServiceExecutableName, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            foreach (var root in new[]
                     {
                         Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                         Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                     }.Where(root => !string.IsNullOrWhiteSpace(root)))
            {
                var protectedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
                var expectedPath = Path.Combine(protectedRoot, "Stats Panel", ServiceExecutableName);
                if (string.Equals(fullPath, expectedPath, StringComparison.OrdinalIgnoreCase)
                    && HasNoReparsePoints(fullPath, protectedRoot))
                {
                    return true;
                }
            }
        }
        catch (Exception error) when (error is ArgumentException
            or IOException
            or UnauthorizedAccessException)
        {
        }

        return false;
    }

    private static bool HasNoReparsePoints(string fullPath, string protectedRoot)
    {
        if ((File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0
            || !HasProtectedAcl(fullPath, isDirectory: false))
        {
            return false;
        }

        var current = Path.GetDirectoryName(fullPath);
        while (!string.IsNullOrWhiteSpace(current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0
                || !HasProtectedAcl(current, isDirectory: true))
            {
                return false;
            }

            if (string.Equals(
                    current.TrimEnd(Path.DirectorySeparatorChar),
                    protectedRoot,
                    StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            current = Directory.GetParent(current)?.FullName;
        }

        return false;
    }

    private static bool HasProtectedAcl(string path, bool isDirectory)
    {
        try
        {
            FileSystemSecurity security;
            if (isDirectory)
            {
                security = new DirectoryInfo(path).GetAccessControl(AccessControlSections.Access);
            }
            else
            {
                security = new FileInfo(path).GetAccessControl(AccessControlSections.Access);
            }
            const FileSystemRights writableRights = FileSystemRights.WriteData
                | FileSystemRights.AppendData
                | FileSystemRights.WriteAttributes
                | FileSystemRights.WriteExtendedAttributes
                | FileSystemRights.Delete
                | FileSystemRights.DeleteSubdirectoriesAndFiles
                | FileSystemRights.ChangePermissions
                | FileSystemRights.TakeOwnership;

            foreach (FileSystemAccessRule rule in security.GetAccessRules(
                         includeExplicit: true,
                         includeInherited: true,
                         targetType: typeof(SecurityIdentifier)))
            {
                if (rule.AccessControlType == AccessControlType.Allow
                    && ((rule.FileSystemRights & writableRights) != 0
                        || rule.FileSystemRights.HasFlag(FileSystemRights.Modify)
                        || rule.FileSystemRights.HasFlag(FileSystemRights.FullControl))
                    && !IsProtectedIdentity((SecurityIdentifier)rule.IdentityReference))
                {
                    return false;
                }
            }

            return true;
        }
        catch (Exception error) when (error is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException
            or PlatformNotSupportedException)
        {
            return false;
        }
    }

    private static bool IsProtectedIdentity(SecurityIdentifier identity)
    {
        if (identity.IsWellKnown(WellKnownSidType.LocalSystemSid)
            || identity.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)
            || identity.IsWellKnown(WellKnownSidType.CreatorOwnerSid))
        {
            return true;
        }

        try
        {
            var account = (NTAccount)identity.Translate(typeof(NTAccount));
            return account.Value.EndsWith("\\Administrators", StringComparison.OrdinalIgnoreCase)
                || account.Value.EndsWith("\\TrustedInstaller", StringComparison.OrdinalIgnoreCase)
                || string.Equals(account.Value, "SYSTEM", StringComparison.OrdinalIgnoreCase);
        }
        catch (IdentityNotMappedException)
        {
            return false;
        }
    }
}

internal static class PawnIoRepairStates
{
    public const string None = "none";
    public const string Attempted = "attempted";
    public const string Throttled = "throttled";
    public const string Unavailable = "unavailable";
    public const string Failed = "failed";
    public const string RebootRequired = "reboot_required";
}

internal sealed record PawnIoRepairResult(
    string State,
    bool Attempted,
    bool RebootRequired,
    int? ExitCode,
    string Message)
{
    public static PawnIoRepairResult None { get; } = new(
        PawnIoRepairStates.None,
        Attempted: false,
        RebootRequired: false,
        ExitCode: null,
        Message: "");
}

internal static class PawnIoRepair
{
    private const string ExpectedInstallerSha256 = "1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032";
    private static readonly object Sync = new();
    private static readonly TimeSpan MinimumRetry = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaximumRetry = TimeSpan.FromHours(2);
    private static readonly TimeSpan InstallerTimeout = TimeSpan.FromSeconds(30);
    private static DateTimeOffset _nextAttemptUtc = DateTimeOffset.MinValue;
    private static int _attempts;
    private static bool _rebootRequired;

    public static PawnIoRepairResult TryRepairIfNeeded(SensorDeviceProbe probe)
    {
        if (probe.Accessible || !string.Equals(probe.State, SensorDeviceStates.NotFound, StringComparison.Ordinal))
        {
            return _rebootRequired
                ? new PawnIoRepairResult(
                    PawnIoRepairStates.RebootRequired,
                    Attempted: false,
                    RebootRequired: true,
                    ExitCode: 3010,
                    Message: "PawnIO was installed, but Windows requires a restart before CPU sensors can be read.")
                : PawnIoRepairResult.None;
        }

        lock (Sync)
        {
            if (_rebootRequired)
            {
                return new PawnIoRepairResult(
                    PawnIoRepairStates.RebootRequired,
                    Attempted: false,
                    RebootRequired: true,
                    ExitCode: 3010,
                    Message: "PawnIO was installed, but Windows requires a restart before CPU sensors can be read.");
            }

            var now = DateTimeOffset.UtcNow;
            if (now < _nextAttemptUtc)
            {
                return new PawnIoRepairResult(
                    PawnIoRepairStates.Throttled,
                    Attempted: false,
                    RebootRequired: false,
                    ExitCode: null,
                    Message: "PawnIO repair is waiting before retrying.");
            }

            if (!TryResolveInstaller(out var installerPath))
            {
                _nextAttemptUtc = now + MinimumRetry;
                return new PawnIoRepairResult(
                    PawnIoRepairStates.Unavailable,
                    Attempted: false,
                    RebootRequired: false,
                    ExitCode: null,
                    Message: "PawnIO is unavailable and the protected repair installer is not present.");
            }

            _attempts++;
            _nextAttemptUtc = now + RetryDelay(_attempts);

            try
            {
                using var process = Process.Start(new ProcessStartInfo
                {
                    FileName = installerPath,
                    Arguments = "-install -silent",
                    WorkingDirectory = Path.GetDirectoryName(installerPath)!,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });

                if (process is null)
                {
                    return Failed(null, "PawnIO repair installer could not be started.");
                }

                if (!process.WaitForExit((int)InstallerTimeout.TotalMilliseconds))
                {
                    try
                    {
                        process.Kill(entireProcessTree: true);
                    }
                    catch (InvalidOperationException)
                    {
                    }

                    return Failed(null, "PawnIO repair installer timed out.");
                }

                var exitCode = process.ExitCode;
                if (exitCode == 3010)
                {
                    _rebootRequired = true;
                    return new PawnIoRepairResult(
                        PawnIoRepairStates.RebootRequired,
                        Attempted: true,
                        RebootRequired: true,
                        ExitCode: exitCode,
                        Message: "PawnIO was installed, but Windows requires a restart before CPU sensors can be read.");
                }

                if (exitCode == 0)
                {
                    return new PawnIoRepairResult(
                        PawnIoRepairStates.Attempted,
                        Attempted: true,
                        RebootRequired: false,
                        ExitCode: exitCode,
                        Message: "PawnIO repair was started. Sensor access will be checked again shortly.");
                }

                return Failed(exitCode, $"PawnIO repair installer exited with code {exitCode}.");
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return Failed(null, $"PawnIO repair installer failed: {error.Message}");
            }
        }
    }

    private static PawnIoRepairResult Failed(int? exitCode, string message)
    {
        return new PawnIoRepairResult(
            PawnIoRepairStates.Failed,
            Attempted: true,
            RebootRequired: false,
            ExitCode: exitCode,
            Message: message);
    }

    private static TimeSpan RetryDelay(int attempts)
    {
        var multiplier = Math.Pow(2, Math.Min(attempts - 1, 4));
        return TimeSpan.FromTicks(Math.Min(
            MaximumRetry.Ticks,
            (long)(MinimumRetry.Ticks * multiplier)));
    }

    private static bool TryResolveInstaller(out string installerPath)
    {
        installerPath = "";
        var baseDirectory = Path.GetFullPath(AppContext.BaseDirectory);
        var candidates = new[]
        {
            Path.Combine(baseDirectory, "binaries", "PawnIO_setup.exe"),
            Path.Combine(baseDirectory, "resources", "PawnIO_setup.exe"),
        };

        foreach (var candidate in candidates)
        {
            if (!File.Exists(candidate)
                || !IsProtectedProgramFilesPath(candidate)
                || !IsTrustedInstaller(candidate))
            {
                continue;
            }

            var attributes = File.GetAttributes(candidate);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                continue;
            }

            installerPath = candidate;
            return true;
        }

        return false;
    }

    private static bool IsTrustedInstaller(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream));
            if (!string.Equals(hash, ExpectedInstallerSha256, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var certificate = System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(path);
            return certificate.Subject.Contains("namazso", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception error) when (error is IOException
            or UnauthorizedAccessException
            or System.Security.Cryptography.CryptographicException)
        {
            return false;
        }
    }

    private static bool IsProtectedProgramFilesPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        foreach (var root in new[]
                 {
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                 }.Where(root => !string.IsNullOrWhiteSpace(root)))
        {
            var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (fullPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}

internal sealed class SensorPipeServer
{
    public const string PipeName = "StatsPanel.Sensor.v1";

    private static readonly TimeSpan SnapshotInterval = TimeSpan.FromSeconds(1);
    private readonly Func<SensorReading> _getLatestReading;

    public SensorPipeServer(Func<SensorReading> getLatestReading)
    {
        _getLatestReading = getLatestReading;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var clients = new List<Task>();

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                clients.RemoveAll(task => task.IsCompleted);
                var pipe = CreatePipe();

                try
                {
                    await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                    clients.Add(HandleClientAsync(pipe, cancellationToken));
                }
                catch
                {
                    pipe.Dispose();
                    throw;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        finally
        {
            await Task.WhenAll(clients).ConfigureAwait(false);
        }
    }

    private static NamedPipeServerStream CreatePipe()
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(CreatePipeRule(WellKnownSidType.LocalSystemSid, PipeAccessRights.FullControl));
        security.AddAccessRule(CreatePipeRule(WellKnownSidType.BuiltinAdministratorsSid, PipeAccessRights.FullControl));
        // The broker is deliberately one-way: desktop clients only receive
        // snapshots. Read + synchronize is sufficient for NamedPipeClientStream
        // in PipeDirection.In and does not grant users ACL mutation rights.
        security.AddAccessRule(CreatePipeRule(
            WellKnownSidType.AuthenticatedUserSid,
            PipeAccessRights.Read | PipeAccessRights.Synchronize));

        return NamedPipeServerStreamAcl.Create(
            PipeName,
            PipeDirection.Out,
            NamedPipeServerStream.MaxAllowedServerInstances,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.WriteThrough,
            0,
            0,
            security);
    }

    private static PipeAccessRule CreatePipeRule(WellKnownSidType sidType, PipeAccessRights rights)
    {
        return new PipeAccessRule(new SecurityIdentifier(sidType, null), rights, AccessControlType.Allow);
    }

    private async Task HandleClientAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        using (pipe)
        using (var writer = new StreamWriter(pipe, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), leaveOpen: true)
               {
                   AutoFlush = true,
                   NewLine = "\n",
               })
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested && pipe.IsConnected)
                {
                    await WriteReadingAsync(writer, _getLatestReading()).ConfigureAwait(false);
                    await Task.Delay(SnapshotInterval, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
            catch (IOException)
            {
            }
            catch (JsonException)
            {
            }
        }
    }

    private static Task WriteReadingAsync(StreamWriter writer, SensorReading reading)
    {
        return writer.WriteLineAsync(JsonSerializer.Serialize(reading, SensorJsonContext.Default.SensorReading));
    }
}
