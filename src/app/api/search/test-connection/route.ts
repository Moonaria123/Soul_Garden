import { NextRequest, NextResponse } from 'next/server';
import { isUrlSafe } from '@/lib/llm/upstream-url';
import { localhostGuard } from '@/lib/security/localhost-guard';

interface TestBody {
  type: 'brave' | 'firecrawl';
  apiKey: string;
  baseUrl?: string;
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: TestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' });
  }

  const { type, apiKey, baseUrl } = body;
  if (!type || !apiKey) {
    return NextResponse.json({ success: false, error: 'Missing type or apiKey' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    if (type === 'brave') {
      const url = 'https://api.search.brave.com/res/v1/web/search?q=test&count=1';
      if (!isUrlSafe(url)) {
        return NextResponse.json({ success: false, error: 'URL blocked' });
      }

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return NextResponse.json({ success: true });
      }
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ success: false, error: 'Invalid API key' });
      }
      return NextResponse.json({
        success: false,
        error: `Brave returned ${res.status}`,
      });
    }

    if (type === 'firecrawl') {
      const fcBase = (baseUrl || 'https://api.firecrawl.dev').replace(/\/+$/, '');
      if (!isUrlSafe(fcBase)) {
        return NextResponse.json({ success: false, error: 'URL blocked by security policy' });
      }

      const res = await fetch(`${fcBase}/v1/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          formats: ['markdown'],
          onlyMainContent: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return NextResponse.json({ success: true });
      }
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ success: false, error: 'Invalid API key' });
      }
      return NextResponse.json({
        success: false,
        error: `Firecrawl returned ${res.status}`,
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown search tool type' });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ success: false, error: 'Connection timed out (10s)' });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg.slice(0, 300) });
  }
}
