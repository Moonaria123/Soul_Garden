// ============================================================
// Unified web-search tool for chat-time function calling.
// (SU-ITER-094 · Phase-C — P1-4 / P1-5)
//
// Why this file exists
// --------------------
// Prior to Phase C the chat flow routed "web search" to whichever
// provider-native field `buildChatPayload` emitted (OpenAI
// `web_search_options`, Anthropic `web_search_20250305`, DashScope
// `enable_search`).  That silently ignored the user's Network
// Search Tool choice (Brave / Firecrawl / LLM-native) in the
// settings page.
//
// Phase C unifies the non-native branches behind a single OpenAI-
// compatible function-calling schema with two tools:
//
//   web_search({ query, count? })   — general-purpose web search
//   fetch_url({ url })              — retrieve a single page's content
//
// The handler in `chat/route.ts` consumes tool_calls emitted by the
// upstream model, dispatches them here, and threads the JSON string
// result back into the conversation as a `tool` / `tool_result`
// message.  See tool-loop-openai.ts / tool-loop-anthropic.ts.
//
// Whitelist enforcement (FC#1 = C)
// ---------------------------------
// The user-configured 世界之眼 whitelist (search-config-store
// `whitelists.worldEye`) is enforced in BOTH directions:
//
//   1. `web_search` results are filtered to entries whose URL matches
//      the whitelist before returning to the model.
//   2. `fetch_url` target URLs are rejected outright if not in the
//      whitelist.
//
// Empty whitelist = fail-open (no filtering) so users who haven't
// configured one still get functional search.  A populated whitelist
// is treated as an intentional restriction.
//
// Result format (FC#4 = JSON)
// ---------------------------
// `executeWebSearchTool` returns a JSON-stringified object so the
// same payload shape flows through both OpenAI's
// `tool`-role messages (OpenAI spec: `content: string`) and
// Anthropic's `tool_result` blocks.  Shape:
//
//   {
//     tool: 'web_search' | 'fetch_url',
//     ok: true,
//     results: [{ title, url, snippet }],
//     query?: string,
//     filteredOut?: number,
//   }
//
// or, on failure:
//
//   { tool, ok: false, error: '...' }
//
// ============================================================

import { isUrlSafe } from '@/lib/llm/upstream-url';
import { safeUpstreamFetch } from '@/lib/security/safe-upstream-fetch';
import type { ActiveSearchTool } from '@/types';

// ---------- Types ----------

export interface WebSearchToolContext {
  /** Which concrete backend to dispatch to. `llm-native` is rejected
   *  at this layer — native provider search never goes through the
   *  tool-calling loop, it rides on vendor-native fields. */
  searchTool: 'brave' | 'firecrawl';
  /** Plaintext API key for the chosen backend. Already decrypted
   *  client-side; never persisted server-side. */
  apiKey: string;
  /** Firecrawl only; ignored for Brave. Defaults to
   *  https://api.firecrawl.dev when absent. */
  baseUrl?: string;
  /** User-configured 世界之眼 whitelist. Empty = no filtering. */
  whitelist: string[];
}

export interface ToolCallResult {
  /** JSON string ready to feed into an OpenAI `tool` message or an
   *  Anthropic `tool_result` block. Never throws. */
  content: string;
  /** Surfaced separately so the tool-loop can count how many
   *  iterations have been exercised without re-parsing the JSON. */
  ok: boolean;
}

// ---------- Tool schemas ----------
//
// The same logical tools are exposed to every provider, but with
// format-correct wrappers so the upstream accepts them verbatim.

/**
 * OpenAI function-calling schema (also accepted by Azure OpenAI,
 * DashScope OpenAI-compatible mode, and most OpenAI-compatible
 * gateways like Poe / OpenRouter / DeepSeek).
 */
export const WEB_SEARCH_TOOL_DEFS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web for up-to-date information. Use this when the user asks about current events, recent news, real-time data, or anything that may have changed since training. Returns a list of result titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query. Use natural language; keep it focused.',
          },
          count: {
            type: 'integer',
            description: 'Number of results to return (1-10). Defaults to 5.',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch and read the full content of a single web page. Use only when you already have a URL (from a prior web_search result, or from the user) and need the full article body. Do not guess URLs.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The absolute https:// URL to fetch.',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
] as const;

/**
 * Anthropic Claude tool-use schema. Same semantics as the OpenAI
 * definitions above; the only differences are the wrapper shape
 * (`input_schema` instead of `parameters`) and the absence of the
 * outer `function` envelope.
 */
export const WEB_SEARCH_TOOL_DEFS_ANTHROPIC = [
  {
    name: 'web_search',
    description:
      'Search the public web for up-to-date information. Use this when the user asks about current events, recent news, real-time data, or anything that may have changed since training. Returns a list of result titles, URLs, and snippets.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Use natural language; keep it focused.',
        },
        count: {
          type: 'integer',
          description: 'Number of results to return (1-10). Defaults to 5.',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch and read the full content of a single web page. Use only when you already have a URL (from a prior web_search result, or from the user) and need the full article body. Do not guess URLs.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute https:// URL to fetch.',
        },
      },
      required: ['url'],
    },
  },
] as const;

// ---------- System-prompt addition (FC#3 = C) ----------
//
// Route-level TECHNICAL description of available tools, injected as
// a system message prefix so the model knows the tools exist AND
// knows the Chinese trigger words that indicate a user intent.
// Persona-level tone shaping stays on the character card and is
// untouched by this injection.

export function buildWebSearchSystemPromptAddition(
  searchTool: ActiveSearchTool,
  whitelist: string[],
): string {
  const whitelistHint =
    whitelist.length > 0
      ? `\n\nSearch results are filtered to the following domains only: ${whitelist.slice(0, 20).join(', ')}${whitelist.length > 20 ? ', ...' : ''}.`
      : '';

  const toolLabel =
    searchTool === 'brave'
      ? 'Brave Search'
      : searchTool === 'firecrawl'
        ? 'Firecrawl'
        : 'native provider search';

  return [
    '# Web Search Capability',
    '',
    `You have access to two tools backed by ${toolLabel}:`,
    '- `web_search(query, count?)` — search the live web for current information.',
    '- `fetch_url(url)` — fetch the full content of a specific web page.',
    '',
    'Call these tools proactively when the user asks about time-sensitive or factual information you cannot answer from memory alone, for example:',
    '- 新闻 / 时事 / 最新 / 最近 / 今天 / 刚刚 / 现在',
    '- 你上网看看 / 帮我查 / 搜一下 / 查一下 / 搜索一下',
    '- news / latest / current / today / look up / search for',
    '',
    'Do NOT call a tool for questions clearly answerable from your general knowledge (historical facts, stable definitions, persona-internal questions, casual chat). Prefer a single focused `web_search` call; use `fetch_url` only to dig into a specific result URL.',
    whitelistHint,
  ].join('\n');
}

// ---------- Whitelist helpers ----------

/**
 * Extract the hostname from a URL, returning null if parsing fails.
 * Accepts inputs like `https://example.com/path`, `example.com`, or
 * `sub.example.com/a?b=c`. Used by `isUrlWhitelisted` so the
 * comparison is host-based rather than naive string contains.
 */
function parseHost(input: string): string | null {
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Match `url` against an entry from the user's whitelist. Whitelist
 * entries can be full URLs, bare hostnames, or wildcards like
 * `*.example.com`. Matching is case-insensitive on host, and a
 * whitelist hostname also matches any subdomain (so `example.com`
 * matches `news.example.com`). Empty whitelist returns true
 * (fail-open).
 */
export function isUrlWhitelisted(url: string, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return true;
  const host = parseHost(url);
  if (!host) return false;

  for (const entry of whitelist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const rawHost = parseHost(trimmed);
    if (!rawHost) continue;
    // Support literal `*.example.com` wildcards by stripping the prefix.
    const allowed = rawHost.startsWith('*.') ? rawHost.slice(2) : rawHost;
    if (host === allowed || host.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter a list of search results down to those whose URL is allowed
 * by the whitelist. Returns both the kept results and the count of
 * filtered-out entries so the caller can report it back to the model.
 */
export function filterResultsByWhitelist<T extends { url: string }>(
  results: T[],
  whitelist: string[],
): { kept: T[]; filteredOut: number } {
  if (!whitelist || whitelist.length === 0) {
    return { kept: results, filteredOut: 0 };
  }
  const kept: T[] = [];
  let filteredOut = 0;
  for (const r of results) {
    if (isUrlWhitelisted(r.url, whitelist)) {
      kept.push(r);
    } else {
      filteredOut++;
    }
  }
  return { kept, filteredOut };
}

// ---------- Executor ----------

interface NormalisedResult {
  title: string;
  url: string;
  snippet: string;
}

const BRAVE_SEARCH_API = 'https://api.search.brave.com/res/v1/web/search';
const FIRECRAWL_DEFAULT_BASE = 'https://api.firecrawl.dev';
const TOOL_FETCH_TIMEOUT_MS = 20_000;

async function runBraveSearch(
  query: string,
  count: number,
  apiKey: string,
): Promise<NormalisedResult[]> {
  if (!isUrlSafe(BRAVE_SEARCH_API)) {
    throw new Error('Brave endpoint blocked by security policy');
  }
  const params = new URLSearchParams({ q: query, count: String(count) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    const res = await safeUpstreamFetch(`${BRAVE_SEARCH_API}?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Brave API returned ${res.status}`);
    }
    const data = (await res.json()) as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function runFirecrawlSearch(
  query: string,
  count: number,
  apiKey: string,
  baseUrl: string,
): Promise<NormalisedResult[]> {
  if (!isUrlSafe(baseUrl)) {
    throw new Error('Firecrawl endpoint blocked by security policy');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    const res = await safeUpstreamFetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit: count,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Firecrawl API returned ${res.status}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        metadata?: { title?: string; sourceURL?: string };
        markdown?: string;
      }>;
    };
    return (data.data ?? []).map((r) => ({
      title: r.metadata?.title ?? '',
      url: r.metadata?.sourceURL ?? '',
      snippet: (r.markdown ?? '').slice(0, 500),
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function runFirecrawlScrape(
  url: string,
  apiKey: string,
  baseUrl: string,
): Promise<NormalisedResult> {
  if (!isUrlSafe(baseUrl)) {
    throw new Error('Firecrawl endpoint blocked by security policy');
  }
  if (!isUrlSafe(url)) {
    throw new Error('Target URL blocked by security policy');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    const res = await safeUpstreamFetch(`${baseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Firecrawl API returned ${res.status}`);
    }
    const data = (await res.json()) as {
      data?: {
        metadata?: { title?: string; sourceURL?: string };
        markdown?: string;
      };
    };
    return {
      title: data.data?.metadata?.title ?? '',
      url: data.data?.metadata?.sourceURL ?? url,
      // Cap content so a 200KB article doesn't blow the model's
      // context window in one go. 12k chars ≈ ~5k tokens.
      snippet: (data.data?.markdown ?? '').slice(0, 12_000),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clamp a user/model-supplied count into [1, 10]. Keeps Brave happy
 * (its free tier caps near 20) and prevents the model from asking
 * for a 100-result dump in a single call.
 */
function clampCount(raw: unknown, fallback = 5): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

/**
 * Dispatch a single tool call. Returns a JSON string ready to be fed
 * back into the conversation as the `content` of a `tool` message
 * (OpenAI) or the `content` of a `tool_result` block (Anthropic).
 *
 * Never throws — all error paths are captured and returned as
 * `{ ok: false, error }` JSON so the model can see the failure and
 * either retry or continue without the tool.
 */
export async function executeWebSearchTool(
  name: string,
  rawArgs: unknown,
  ctx: WebSearchToolContext,
): Promise<ToolCallResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;

  try {
    if (name === 'web_search') {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        return fail('web_search', 'Missing required argument: query');
      }
      const count = clampCount(args.count);
      const raw =
        ctx.searchTool === 'brave'
          ? await runBraveSearch(query, count, ctx.apiKey)
          : await runFirecrawlSearch(
              query,
              count,
              ctx.apiKey,
              (ctx.baseUrl ?? FIRECRAWL_DEFAULT_BASE).replace(/\/+$/, ''),
            );

      const { kept, filteredOut } = filterResultsByWhitelist(raw, ctx.whitelist);
      return ok('web_search', {
        query,
        results: kept,
        filteredOut: filteredOut > 0 ? filteredOut : undefined,
      });
    }

    if (name === 'fetch_url') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return fail('fetch_url', 'Missing required argument: url');
      }
      // Whitelist enforcement per FC#1 = C — scrape targets must be
      // explicitly allow-listed when a whitelist is configured.
      if (!isUrlWhitelisted(url, ctx.whitelist)) {
        return fail(
          'fetch_url',
          `URL "${url}" is not in the user-configured whitelist; refuse to fetch.`,
        );
      }
      // Brave has no scrape endpoint — route scrape through Firecrawl
      // regardless of the selected search tool. If the user hasn't
      // configured Firecrawl we can't fulfil the request; return a
      // structured error so the model can fall back to summarising
      // the snippet it already has from web_search.
      if (ctx.searchTool !== 'firecrawl') {
        return fail(
          'fetch_url',
          'fetch_url requires Firecrawl to be configured as the active search tool; Brave does not support page scraping.',
        );
      }
      const result = await runFirecrawlScrape(
        url,
        ctx.apiKey,
        (ctx.baseUrl ?? FIRECRAWL_DEFAULT_BASE).replace(/\/+$/, ''),
      );
      return ok('fetch_url', { results: [result] });
    }

    return fail(name, `Unknown tool: ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'tool execution failed';
    return fail(name, msg.slice(0, 300));
  }
}

function ok(
  tool: string,
  payload: Record<string, unknown>,
): ToolCallResult {
  return {
    content: JSON.stringify({ tool, ok: true, ...payload }),
    ok: true,
  };
}

function fail(tool: string, error: string): ToolCallResult {
  return {
    content: JSON.stringify({ tool, ok: false, error }),
    ok: false,
  };
}
