import type { SearchResult, SearchOutcome } from './search-types';

export async function searchBrave(
  query: string,
  apiKey: string,
  options?: { count?: number; freshness?: string }
): Promise<SearchOutcome> {
  try {
    const res = await fetch('/api/search/brave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        query,
        count: options?.count ?? 10,
        freshness: options?.freshness,
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
    const msg = err instanceof Error ? err.message : 'Brave search failed';
    return { success: false, error: msg };
  }
}
