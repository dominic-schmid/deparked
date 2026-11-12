import type {
  ApiError,
  CheckRequest,
  CheckResponse,
  FinishRequest,
  FinishResponse,
  Status,
  StepRequest,
  StepResponse,
} from "../api";

const OFFLINE: ApiError = {
  ok: false,
  error: "cloudflare",
  message: "The installer did not answer. Check your connection, then try again.",
};

async function post<T>(path: string, body: unknown): Promise<T | ApiError> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    return (await response.json()) as T | ApiError;
  } catch {
    return OFFLINE;
  }
}

export async function getStatus(): Promise<Status | null> {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    return response.ok ? ((await response.json()) as Status) : null;
  } catch {
    return null;
  }
}

export const checkToken = (input: CheckRequest) => post<CheckResponse>("/api/check", input);
export const runStep = (input: StepRequest) => post<StepResponse>("/api/step", input);
export const finishInstall = (input: FinishRequest) => post<FinishResponse>("/api/finish", input);
