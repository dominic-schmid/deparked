import { z } from "zod";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloudflareErrorDetail {
  code: number;
  message: string;
}

/**
 * Every failed call throws this. The message names the call ("create Worker route failed: 403 ...").
 * It never contains the API token or any value registered as sensitive (secrets, upload tokens).
 */
export class CloudflareApiError extends Error {
  override readonly name = "CloudflareApiError";
  readonly call: string;
  /** HTTP status; 0 when no response arrived. */
  readonly status: number;
  readonly errors: readonly CloudflareErrorDetail[];
  readonly attempts: number;

  constructor(input: {
    call: string;
    status: number;
    errors?: readonly CloudflareErrorDetail[];
    detail?: string;
    attempts?: number;
  }) {
    const errors = input.errors ?? [];
    const detail = input.detail ?? errors.map((error) => `${error.message} (code ${error.code})`).join("; ");
    const status = input.status === 0 ? "no response" : String(input.status);
    super(`${input.call} failed: ${status}${detail === "" ? "" : ` ${detail}`}`);
    this.call = input.call;
    this.status = input.status;
    this.errors = errors;
    this.attempts = input.attempts ?? 1;
  }

  get codes(): number[] {
    return this.errors.map((error) => error.code);
  }
}

export interface ClientOptions {
  token: string;
  accountId: string;
  fetch?: FetchLike;
  /** Defaults to Cloudflare's API. Tests and the E2E harness point this at the mock. */
  baseUrl?: string;
  /** Attempts per request, including the first. Default 3. */
  maxAttempts?: number;
  /** Upper bound for one backoff wait, also applied to `Retry-After`. Default 10 s. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RequestSpec {
  /** Plain-words name used in errors, for example "create Worker route". */
  call: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  form?: FormData;
  /** Bearer token for this request instead of the API token (the assets upload uses the session token). */
  bearer?: string;
}

export interface PageOptions {
  perPage?: number;
  /** Stop with an error after this many pages, so one call can't eat a Worker's subrequest budget. Default 20. */
  maxPages?: number;
}

export interface Envelope<T> {
  result: T;
  status: number;
  totalPages: number | undefined;
}

export interface Http {
  readonly accountId: string;
  /** Requests sent so far, retries included. Compare before and after a call to budget subrequests. */
  readonly requestCount: number;
  request<T>(spec: RequestSpec, schema: z.ZodType<T>): Promise<T>;
  envelope<T>(spec: RequestSpec, schema: z.ZodType<T>): Promise<Envelope<T>>;
  /** Like `request`, but a 404 answers `null`. */
  requestOrNull<T>(spec: RequestSpec, schema: z.ZodType<T>): Promise<T | null>;
  /** Follows `page`/`per_page` until a short page. One request per page. */
  paginate<T>(spec: RequestSpec, item: z.ZodType<T>, options?: PageOptions): Promise<T[]>;
  /** Raw POST to the GraphQL Analytics API (`{ data, errors }`, no v4 envelope). */
  graphql<T>(call: string, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T>;
  /** Register a value that must never appear in an error message. */
  hide(value: string): void;
}

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const BASE_DELAY_MS = 250;

const errorList = z
  .array(z.object({ code: z.number().catch(0), message: z.string().catch("") }))
  .nullish()
  .transform((errors) => errors ?? []);

const envelopeSchema = z.object({
  success: z.boolean().optional(),
  errors: errorList,
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number().optional() }).nullish(),
});

const graphqlSchema = z.object({
  data: z.unknown(),
  errors: z
    .array(z.object({ message: z.string().catch("") }))
    .nullish()
    .transform((errors) => errors ?? []),
});

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function describeIssues(error: z.ZodError): string {
  const fields = error.issues.map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`);
  return `unexpected response shape (${fields.slice(0, 5).join("; ")})`;
}

export function createHttp(options: ClientOptions): Http {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const hidden = new Set<string>([options.token]);
  let requestCount = 0;

  function redact(text: string): string {
    let clean = text;
    for (const value of hidden) {
      if (value !== "") clean = clean.split(value).join("[redacted]");
    }
    return clean;
  }

  function fail(input: ConstructorParameters<typeof CloudflareApiError>[0]): CloudflareApiError {
    return new CloudflareApiError({
      ...input,
      call: redact(input.call),
      ...(input.detail === undefined ? {} : { detail: redact(input.detail) }),
      ...(input.errors === undefined
        ? {}
        : { errors: input.errors.map((error) => ({ code: error.code, message: redact(error.message) })) }),
    });
  }

  function url(spec: RequestSpec): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const search = query.toString();
    return `${baseUrl}${spec.path}${search === "" ? "" : `?${search}`}`;
  }

  function backoffMs(attempt: number, response: Response | undefined): number {
    const asked = response === undefined ? undefined : retryAfterMs(response, Date.now());
    if (asked !== undefined) return Math.min(asked, maxDelayMs);
    const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), maxDelayMs);
    return ceiling / 2 + random() * (ceiling / 2);
  }

  /** Sends with retries on 429 and 5xx. A request that got no response is retried only when it is safe to repeat. */
  async function send(spec: RequestSpec): Promise<{ response: Response; attempts: number }> {
    const headers: Record<string, string> = { authorization: `Bearer ${spec.bearer ?? options.token}` };
    if (spec.json !== undefined) headers["content-type"] = "application/json";
    const init: RequestInit = { method: spec.method, headers };
    if (spec.json !== undefined) init.body = JSON.stringify(spec.json);
    if (spec.form !== undefined) init.body = spec.form;
    const target = url(spec);

    for (let attempt = 1; ; attempt += 1) {
      requestCount += 1;
      let response: Response | undefined;
      try {
        response = await fetchImpl(target, init);
      } catch {
        if (attempt >= maxAttempts || spec.method === "POST") {
          throw fail({ call: spec.call, status: 0, detail: "network error", attempts: attempt });
        }
      }
      if (response !== undefined && (!isRetryable(response.status) || attempt >= maxAttempts)) {
        return { response, attempts: attempt };
      }
      await response?.body?.cancel();
      await sleep(backoffMs(attempt, response));
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  async function envelope<T>(spec: RequestSpec, schema: z.ZodType<T>): Promise<Envelope<T>> {
    const { response, attempts } = await send(spec);
    const parsed = envelopeSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw fail({ call: spec.call, status: response.status, detail: "response was not JSON", attempts });
    }
    if (!response.ok || parsed.data.success === false) {
      throw fail({ call: spec.call, status: response.status, errors: parsed.data.errors, attempts });
    }
    const result = schema.safeParse(parsed.data.result);
    if (!result.success) {
      throw fail({ call: spec.call, status: response.status, detail: describeIssues(result.error), attempts });
    }
    return { result: result.data, status: response.status, totalPages: parsed.data.result_info?.total_pages };
  }

  async function request<T>(spec: RequestSpec, schema: z.ZodType<T>): Promise<T> {
    return (await envelope(spec, schema)).result;
  }

  return {
    accountId: options.accountId,
    get requestCount() {
      return requestCount;
    },
    request,
    envelope,
    hide(value) {
      hidden.add(value);
    },
    async requestOrNull(spec, schema) {
      try {
        return await request(spec, schema);
      } catch (error) {
        if (error instanceof CloudflareApiError && error.status === 404) return null;
        throw error;
      }
    },
    async paginate<T>(spec: RequestSpec, item: z.ZodType<T>, pageOptions: PageOptions = {}): Promise<T[]> {
      const perPage = pageOptions.perPage ?? 50;
      const maxPages = pageOptions.maxPages ?? 20;
      const items: T[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const { result, totalPages } = await envelope(
          { ...spec, query: { ...spec.query, page, per_page: perPage } },
          z.array(item),
        );
        items.push(...result);
        if (result.length < perPage || (totalPages !== undefined && page >= totalPages)) return items;
      }
      throw fail({ call: spec.call, status: 200, detail: `more than ${maxPages} pages of results` });
    },
    async graphql<T>(call: string, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>) {
      const { response, attempts } = await send({
        call,
        method: "POST",
        path: "/graphql",
        json: { query, variables },
      });
      const parsed = graphqlSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        throw fail({ call, status: response.status, detail: "response was not JSON", attempts });
      }
      if (!response.ok || parsed.data.errors.length > 0) {
        const detail = parsed.data.errors.map((error) => error.message).join("; ");
        throw fail({ call, status: response.status, detail, attempts });
      }
      const data = schema.safeParse(parsed.data.data);
      if (!data.success) throw fail({ call, status: response.status, detail: describeIssues(data.error), attempts });
      return data.data;
    },
  };
}
