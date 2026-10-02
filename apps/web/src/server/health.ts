/**
 * Health checks for monitors (DECISIONS D-112). `/api/health` says the web server answers
 * (liveness) and which release it runs; `/api/health/ready` says it can serve pages: Supabase
 * Auth, PostgREST and, when configured, the substitute and class portals' database connections.
 * Neither ever gives details: a monitor outside the server reads them, and the probes' failures
 * go to the server's own log. Pure apart from the probes it is given, so it is unit tested.
 */

export interface Health {
  status: 'ok';
  release: string;
}

export function buildHealth(release: string): Health {
  return { status: 'ok', release };
}

export interface Readiness {
  ok: boolean;
  /** Probe names only (`auth`, `rest`, `subPortal`, `classPortal`), for the server's log. */
  failing: string[];
}

export interface Probe {
  name: string;
  /** Resolves when the dependency answers; rejects (or never settles) otherwise. */
  check: (signal: AbortSignal) => Promise<void>;
}

export const PROBE_TIMEOUT_MS = 2000;

/** Runs every probe at once, each cut off after `timeoutMs`. */
export async function runProbes(probes: Probe[], timeoutMs = PROBE_TIMEOUT_MS): Promise<Readiness> {
  const results = await Promise.all(
    probes.map(async (probe) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      try {
        await Promise.race([probe.check(controller.signal), timeout]);
        return null;
      } catch {
        return probe.name;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const failing = results.filter((name): name is string => name !== null);
  return { ok: failing.length === 0, failing };
}

type Fetch = (input: string, init: RequestInit) => Promise<{ status: number }>;

export interface ReadyOptions {
  supabaseUrl: string;
  anonKey: string;
  /** `select 1` on each portal pool that is configured. */
  portalPools: { name: string; ping: () => Promise<unknown> }[];
  fetch?: Fetch;
  timeoutMs?: number;
}

/**
 * Auth must answer its health check with 200. PostgREST is up when it answers below 500 (a
 * gateway answers 502 to 504 when it is down, PostgREST 503 when it lost the database): a HEAD
 * of the API's root, which sends no body.
 */
export function readinessProbes(options: ReadyOptions): Probe[] {
  const fetchFn: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.supabaseUrl.replace(/\/+$/, '');
  const headers = { apikey: options.anonKey };
  return [
    {
      name: 'auth',
      check: async (signal) => {
        const response = await fetchFn(`${base}/auth/v1/health`, {
          headers,
          signal,
          cache: 'no-store',
        });
        if (response.status !== 200) throw new Error(`auth ${response.status}`);
      },
    },
    {
      name: 'rest',
      check: async (signal) => {
        const response = await fetchFn(`${base}/rest/v1/`, {
          method: 'HEAD',
          headers,
          signal,
          cache: 'no-store',
        });
        if (response.status >= 500) throw new Error(`rest ${response.status}`);
      },
    },
    ...options.portalPools.map((pool) => ({
      name: pool.name,
      check: async () => {
        await pool.ping();
      },
    })),
  ];
}

export function checkReady(options: ReadyOptions): Promise<Readiness> {
  return runProbes(readinessProbes(options), options.timeoutMs);
}
