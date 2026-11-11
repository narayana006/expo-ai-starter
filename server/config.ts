/** Proxy configuration, read from environment variables. */

export interface ProxyConfig {
  port: number;
  /** True when no upstream is configured (or MOCK=1): replies are canned text. */
  mock: boolean;
  /** Base URL of an OpenAI-compatible API, for example https://models.example.com/v1 */
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  model: string;
  /** Prepended to every conversation on the server, so the app cannot change it. */
  systemPrompt: string;
  /** Value of the Access-Control-Allow-Origin header (only browsers care). */
  allowedOrigin: string;
  /** Requests allowed per client address per minute; 0 turns the limit off. */
  rateLimitPerMinute: number;
  maxMessages: number;
  /** Upper bound on the combined length of all message contents. */
  maxTotalChars: number;
  /** Pause between chunks of the canned reply, in milliseconds. */
  mockDelayMs: number;
}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer of at least ${min}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: Env): ProxyConfig {
  const upstreamBaseUrl = (env.UPSTREAM_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const forcedMock = /^(1|true|yes)$/i.test((env.MOCK ?? '').trim());
  if (upstreamBaseUrl !== '') {
    let url: URL;
    try {
      url = new URL(upstreamBaseUrl);
    } catch {
      throw new Error(`UPSTREAM_BASE_URL is not a valid URL: ${upstreamBaseUrl}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('UPSTREAM_BASE_URL must start with https:// or http://');
    }
  }
  const mock = forcedMock || upstreamBaseUrl === '';
  const model = (env.UPSTREAM_MODEL ?? '').trim();
  if (!mock && model === '') {
    throw new Error('UPSTREAM_MODEL is required when UPSTREAM_BASE_URL is set');
  }
  return {
    port: integer(env, 'PORT', 8787, 0),
    mock,
    upstreamBaseUrl,
    upstreamApiKey: (env.UPSTREAM_API_KEY ?? '').trim(),
    model,
    systemPrompt: (env.SYSTEM_PROMPT ?? '').trim(),
    allowedOrigin: (env.ALLOWED_ORIGIN ?? '*').trim(),
    rateLimitPerMinute: integer(env, 'RATE_LIMIT_PER_MINUTE', 30, 0),
    maxMessages: integer(env, 'MAX_MESSAGES', 50, 1),
    maxTotalChars: integer(env, 'MAX_TOTAL_CHARS', 32000, 1),
    mockDelayMs: integer(env, 'MOCK_DELAY_MS', 40, 0),
  };
}
