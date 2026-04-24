import type { SearchResult, SearchOutcome } from './search-types';

export async function searchFirecrawl(
  query: string,
  apiKey: string,
  baseUrl?: string,
  options?: { limit?: number }
): Promise<SearchOutcome> {
  try {
    const res = await fetch('/api/search/firecrawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        baseUrl,
        query,
        limit: options?.limit ?? 5,
      }),
    });

    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      results: (data.results || []) as SearchResult[],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Firecrawl search failed';
    return { success: false, error: msg };
  }
}

export async function scrapeFirecrawl(
  url: string,
  apiKey: string,
  baseUrl?: string,
): Promise<SearchOutcome> {
  try {
    const res = await fetch('/api/search/firecrawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, baseUrl, url }),
    });

    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      results: (data.results || []) as SearchResult[],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Firecrawl scrape failed';
    return { success: false, error: msg };
  }
}
