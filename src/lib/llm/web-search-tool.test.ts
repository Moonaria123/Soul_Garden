// SU-ITER-094 · Phase-C5 — unit tests for the unified chat-time
// web-search tool.  These cover:
//
//   * the pure whitelist helpers (`isUrlWhitelisted`,
//     `filterResultsByWhitelist`) in both directions, including the
//     `*.example.com` wildcard and subdomain-suffix semantics;
//   * the technical system-prompt builder;
//   * the JSON shape returned by `executeWebSearchTool` for each of
//     the four branches: successful Brave search (with whitelist
//     filtering), Firecrawl scrape (rejected because Brave is
//     active), fetch_url (rejected by whitelist), and unknown-tool
//     fallthrough.
//
// Upstream HTTP is stubbed via `vi.mock` so the tests never hit the
// network.  The mock for `@/lib/llm/upstream-url` short-circuits
// `isUrlSafe` to true; the production SSRF guards have their own
// dedicated test suites and are exercised by integration tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm/upstream-url', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm/upstream-url')>(
    '@/lib/llm/upstream-url',
  );
  return { ...actual, isUrlSafe: () => true };
});

const safeUpstreamFetch = vi.fn();
vi.mock('@/lib/security/safe-upstream-fetch', () => ({
  safeUpstreamFetch: (...args: unknown[]) => safeUpstreamFetch(...args),
}));

import {
  isUrlWhitelisted,
  filterResultsByWhitelist,
  buildWebSearchSystemPromptAddition,
  executeWebSearchTool,
  WEB_SEARCH_TOOL_DEFS_OPENAI,
  WEB_SEARCH_TOOL_DEFS_ANTHROPIC,
} from './web-search-tool';

beforeEach(() => {
  safeUpstreamFetch.mockReset();
});

describe('isUrlWhitelisted', () => {
  it('fails open on empty whitelist', () => {
    expect(isUrlWhitelisted('https://random.example/xyz', [])).toBe(true);
  });

  it('matches exact hostname', () => {
    expect(isUrlWhitelisted('https://example.com/a', ['example.com'])).toBe(true);
    expect(isUrlWhitelisted('https://other.org/a', ['example.com'])).toBe(false);
  });

  it('matches subdomain via suffix rule', () => {
    expect(
      isUrlWhitelisted('https://news.example.com/a', ['example.com']),
    ).toBe(true);
  });

  it('supports *.example.com wildcards', () => {
    expect(
      isUrlWhitelisted('https://a.b.example.com/x', ['*.example.com']),
    ).toBe(true);
  });

  it('rejects unparseable URLs when whitelist is populated', () => {
    expect(isUrlWhitelisted('not a url', ['example.com'])).toBe(false);
  });

  it('ignores blank whitelist entries', () => {
    expect(
      isUrlWhitelisted('https://example.com', ['  ', '', 'example.com']),
    ).toBe(true);
  });
});

describe('filterResultsByWhitelist', () => {
  it('returns all results on empty whitelist', () => {
    const r = [{ url: 'https://a.com' }, { url: 'https://b.com' }];
    const { kept, filteredOut } = filterResultsByWhitelist(r, []);
    expect(kept).toHaveLength(2);
    expect(filteredOut).toBe(0);
  });

  it('drops off-list entries and reports the count', () => {
    const r = [
      { url: 'https://allowed.com/a', title: 't1' },
      { url: 'https://blocked.net/b', title: 't2' },
      { url: 'https://sub.allowed.com/c', title: 't3' },
    ];
    const { kept, filteredOut } = filterResultsByWhitelist(r, ['allowed.com']);
    expect(kept.map((k) => k.url)).toEqual([
      'https://allowed.com/a',
      'https://sub.allowed.com/c',
    ]);
    expect(filteredOut).toBe(1);
  });
});

describe('buildWebSearchSystemPromptAddition', () => {
  it('names the active tool and omits whitelist note when empty', () => {
    const s = buildWebSearchSystemPromptAddition('brave', []);
    expect(s).toContain('Brave Search');
    expect(s).toContain('web_search');
    expect(s).toContain('fetch_url');
    expect(s).not.toContain('filtered to the following domains');
  });

  it('discloses the whitelist (truncated) when one is set', () => {
    const whitelist = Array.from({ length: 25 }, (_, i) => `site${i}.com`);
    const s = buildWebSearchSystemPromptAddition('firecrawl', whitelist);
    expect(s).toContain('Firecrawl');
    expect(s).toContain('filtered to the following domains');
    expect(s).toContain('site0.com');
    // 20-cap then ellipsis
    expect(s).toContain(', ...');
  });

  it('includes the Chinese trigger-word hints', () => {
    const s = buildWebSearchSystemPromptAddition('brave', []);
    expect(s).toMatch(/新闻|最新|搜一下/);
  });
});

describe('tool schema definitions', () => {
  it('exposes both web_search and fetch_url for OpenAI', () => {
    const names = WEB_SEARCH_TOOL_DEFS_OPENAI.map((d) => d.function.name);
    expect(names).toEqual(['web_search', 'fetch_url']);
  });

  it('exposes both web_search and fetch_url for Anthropic', () => {
    const names = WEB_SEARCH_TOOL_DEFS_ANTHROPIC.map((d) => d.name);
    expect(names).toEqual(['web_search', 'fetch_url']);
  });
});

describe('executeWebSearchTool — web_search via Brave', () => {
  it('returns a normalised result list filtered by whitelist', async () => {
    safeUpstreamFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: 'A', url: 'https://allowed.com/a', description: 's1' },
            { title: 'B', url: 'https://blocked.net/b', description: 's2' },
          ],
        },
      }),
    });

    const res = await executeWebSearchTool(
      'web_search',
      { query: 'hello', count: 3 },
      {
        searchTool: 'brave',
        apiKey: 'k',
        whitelist: ['allowed.com'],
      },
    );

    expect(res.ok).toBe(true);
    const payload = JSON.parse(res.content);
    expect(payload.tool).toBe('web_search');
    expect(payload.ok).toBe(true);
    expect(payload.query).toBe('hello');
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].url).toBe('https://allowed.com/a');
    expect(payload.filteredOut).toBe(1);
  });

  it('fails gracefully on missing query', async () => {
    const res = await executeWebSearchTool(
      'web_search',
      {},
      { searchTool: 'brave', apiKey: 'k', whitelist: [] },
    );
    expect(res.ok).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.error).toMatch(/query/);
    expect(safeUpstreamFetch).not.toHaveBeenCalled();
  });

  it('wraps upstream errors in a fail payload instead of throwing', async () => {
    safeUpstreamFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const res = await executeWebSearchTool(
      'web_search',
      { query: 'x' },
      { searchTool: 'brave', apiKey: 'k', whitelist: [] },
    );
    expect(res.ok).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/500/);
  });
});

describe('executeWebSearchTool — fetch_url', () => {
  it('rejects URLs outside the whitelist without fetching', async () => {
    const res = await executeWebSearchTool(
      'fetch_url',
      { url: 'https://blocked.net/page' },
      {
        searchTool: 'firecrawl',
        apiKey: 'k',
        whitelist: ['allowed.com'],
      },
    );
    expect(res.ok).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.error).toMatch(/whitelist/);
    expect(safeUpstreamFetch).not.toHaveBeenCalled();
  });

  it('rejects when the active tool is Brave (no scrape support)', async () => {
    const res = await executeWebSearchTool(
      'fetch_url',
      { url: 'https://allowed.com/page' },
      {
        searchTool: 'brave',
        apiKey: 'k',
        whitelist: [], // fail-open whitelist so that branch doesn't trip first
      },
    );
    expect(res.ok).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.error).toMatch(/Firecrawl/);
    expect(safeUpstreamFetch).not.toHaveBeenCalled();
  });

  it('scrapes via Firecrawl and caps the snippet length', async () => {
    const longBody = 'a'.repeat(20_000);
    safeUpstreamFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          metadata: { title: 'T', sourceURL: 'https://allowed.com/page' },
          markdown: longBody,
        },
      }),
    });

    const res = await executeWebSearchTool(
      'fetch_url',
      { url: 'https://allowed.com/page' },
      {
        searchTool: 'firecrawl',
        apiKey: 'k',
        baseUrl: 'https://api.firecrawl.dev',
        whitelist: ['allowed.com'],
      },
    );

    expect(res.ok).toBe(true);
    const payload = JSON.parse(res.content);
    expect(payload.results[0].url).toBe('https://allowed.com/page');
    expect(payload.results[0].snippet.length).toBe(12_000);
  });
});

describe('executeWebSearchTool — unknown tool', () => {
  it('returns a structured error without calling any backend', async () => {
    const res = await executeWebSearchTool(
      'nope',
      {},
      { searchTool: 'brave', apiKey: 'k', whitelist: [] },
    );
    expect(res.ok).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.error).toMatch(/Unknown tool/);
    expect(safeUpstreamFetch).not.toHaveBeenCalled();
  });
});
