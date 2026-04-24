import { NextRequest, NextResponse } from 'next/server';
import { isUrlSafe } from '@/lib/llm/upstream-url';
import { localhostGuard } from '@/lib/security/localhost-guard';

const BRAVE_SEARCH_API = 'https://api.search.brave.com/res/v1/web/search';

interface BraveSearchBody {
  apiKey: string;
  query: string;
  count?: number;
  freshness?: string;
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: BraveSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { apiKey, query, count = 10, freshness } = body;
  if (!apiKey || !query) {
    return NextResponse.json({ error: 'Missing apiKey or query' }, { status: 400 });
  }

  if (!isUrlSafe(BRAVE_SEARCH_API)) {
    return NextResponse.json({ error: 'URL blocked by security policy' }, { status: 403 });
  }

  const params = new URLSearchParams({ q: query, count: String(count) });
  if (freshness) params.set('freshness', freshness);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${BRAVE_SEARCH_API}?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Brave API returned ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const results = (data.web?.results || []).map(
      (r: { title?: string; url?: string; description?: string; extra_snippets?: string[] }) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || '',
        extraSnippets: r.extra_snippets || [],
      })
    );

    return NextResponse.json({ results, total: data.web?.totalResults || results.length });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out (15s)' }, { status: 504 });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
