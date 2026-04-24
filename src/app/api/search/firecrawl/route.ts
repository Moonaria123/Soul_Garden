import { NextRequest, NextResponse } from 'next/server';
import { isUrlSafe } from '@/lib/llm/upstream-url';
import { localhostGuard } from '@/lib/security/localhost-guard';

interface FirecrawlSearchBody {
  apiKey: string;
  baseUrl?: string;
  query?: string;
  url?: string;
  limit?: number;
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: FirecrawlSearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { apiKey, query, url, limit = 5 } = body;
  const baseUrl = (body.baseUrl || 'https://api.firecrawl.dev').replace(/\/+$/, '');

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing apiKey' }, { status: 400 });
  }
  if (!query && !url) {
    return NextResponse.json({ error: 'Missing query or url' }, { status: 400 });
  }

  if (!isUrlSafe(baseUrl)) {
    return NextResponse.json({ error: 'Base URL blocked by security policy' }, { status: 403 });
  }
  if (url && !isUrlSafe(url)) {
    return NextResponse.json({ error: 'Target URL blocked by security policy' }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    if (url) {
      const res = await fetch(`${baseUrl}/v1/scrape`, {
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
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json(
          { error: `Firecrawl API returned ${res.status}`, detail: text.slice(0, 500) },
          { status: res.status }
        );
      }

      const data = await res.json();
      return NextResponse.json({
        results: [{
          title: data.data?.metadata?.title || '',
          url: data.data?.metadata?.sourceURL || url,
          snippet: (data.data?.markdown || '').slice(0, 500),
          content: (data.data?.markdown || '').slice(0, 50000),
        }],
      });
    }

    const res = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Firecrawl API returned ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const results = (data.data || []).map(
      (r: { metadata?: { title?: string; sourceURL?: string }; markdown?: string }) => ({
        title: r.metadata?.title || '',
        url: r.metadata?.sourceURL || '',
        snippet: (r.markdown || '').slice(0, 500),
        content: (r.markdown || '').slice(0, 50000),
      })
    );

    return NextResponse.json({ results });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out (30s)' }, { status: 504 });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
