import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

const UPDATE_TIMEOUT_MS = 30_000;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "downloading"
  | "installing"
  | "installed"
  | "error";

export type AppUpdateState = {
  automatic?: boolean;
  checkedAt?: string;
  contentLength?: number;
  currentVersion?: string;
  downloadedBytes?: number;
  error?: string;
  message: string;
  progress?: number;
  status: UpdateStatus;
  version?: string;
};

export const INITIAL_UPDATE_STATE: AppUpdateState = {
  message: "Updates have not been checked yet.",
  status: "idle",
};

export async function checkAndInstallUpdate(
  emit: (state: AppUpdateState) => void,
  options: { automatic?: boolean } = {},
) {
  const automatic = options.automatic ?? false;
  emit({
    automatic,
    message: "Checking for updates...",
    status: "checking",
  });

  try {
    const update = await check({ timeout: UPDATE_TIMEOUT_MS });
    if (!update) {
      emit({
        automatic,
        checkedAt: new Date().toISOString(),
        message: "Stats Panel is up to date.",
        status: "upToDate",
      });
      return;
    }

    let contentLength: number | undefined;
    let downloadedBytes = 0;
    const baseState = {
      automatic,
      currentVersion: update.currentVersion,
      version: update.version,
    };

    emit({
      ...baseState,
      downloadedBytes,
      message: `Downloading Stats Panel ${update.version}...`,
      status: "downloading",
    });

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength;
        downloadedBytes = 0;
        emit({
          ...baseState,
          contentLength,
          downloadedBytes,
          message: `Downloading Stats Panel ${update.version}...`,
          progress: progressPercent(downloadedBytes, contentLength),
          status: "downloading",
        });
        return;
      }

      if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        emit({
          ...baseState,
          contentLength,
          downloadedBytes,
          message: `Downloading Stats Panel ${update.version}...`,
          progress: progressPercent(downloadedBytes, contentLength),
          status: "downloading",
        });
        return;
      }

      emit({
        ...baseState,
        contentLength,
        downloadedBytes,
        message: `Installing Stats Panel ${update.version}...`,
        progress: 100,
        status: "installing",
      });
    }, { timeout: UPDATE_TIMEOUT_MS });

    emit({
      ...baseState,
      checkedAt: new Date().toISOString(),
      contentLength,
      downloadedBytes,
      message: `Stats Panel ${update.version} is installed. Restart to finish.`,
      progress: 100,
      status: "installed",
    });
  } catch (error) {
    emit({
      automatic,
      checkedAt: new Date().toISOString(),
      error: String(error),
      message: "Update failed. Check your network or system proxy, then try again.",
      status: "error",
    });
  }
}

export function restartApp() {
  return relaunch();
}

function progressPercent(downloadedBytes: number, contentLength?: number) {
  if (!contentLength || contentLength <= 0) {
    return undefined;
  }
  return Math.min(100, Math.round((downloadedBytes / contentLength) * 100));
}
