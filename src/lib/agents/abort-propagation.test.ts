/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// SU-ITER-092-batch2 · AbortSignal threading
//
// Previously the soul-extraction pipeline polled
// `signal?.aborted` at three serial checkpoints but never passed the
// signal into `fetch`/the SSE reader, so a cancel could only be
// observed *between* LLM calls — an in-flight token stream ran to
// completion before surfacing as a cancellation.  This file pins the
// new contract: the signal is threaded all the way down into
// `fetch(url, { signal })` and into the SSE reader loop, so a deliberate
// abort (a) reaches the underlying HTTP stream, (b) causes
// `callLLMDirectFull` to reject with an AbortError, and (c) lets
// `runExtractionPipeline` fire `onCancelled` without waiting for the
// current step's token stream to drain.
// ============================================================

interface FetchInit {
  method?: string;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Build an SSE Response whose body stream only yields tokens when we
 * explicitly call `push()` on it — lets the test control timing around
 * abort.  The body is also *not* closed until `close()` is called, so
 * if the signal never fires, the caller would hang forever (which is
 * exactly what we want to prove gets torn down on abort).
 */
function makeControllableSseResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // A real fetch abort cancels the reader — we track this so the
      // test can assert the pipeline actually tears down the stream.
      cancelCalled = true;
    },
  });
  let cancelCalled = false;
  const push = (chunk: string) => {
    controller.enqueue(new TextEncoder().encode(chunk));
  };
  const close = () => controller.close();
  const getCancelCalled = () => cancelCalled;
  const response = new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  return { response, push, close, getCancelCalled };
}

describe('callLLMDirectFull · AbortSignal threading', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('passes the signal straight through to fetch()', async () => {
    const { response, push, close } = makeControllableSseResponse();
    fetchSpy.mockResolvedValueOnce(response);

    const controller = new AbortController();
    const { callLLMDirectFull } = await import('./llm-client');

    // Stream a final DONE line and close cleanly so the call resolves.
    push('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    push('data: [DONE]\n\n');
    close();

    await callLLMDirectFull(
      [{ role: 'user', content: 'ping' }],
      {
        apiKey: 'k',
        baseURL: 'https://example.invalid/v1',
        model: 'test',
      },
      controller.signal,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as FetchInit;
    expect(init.signal).toBe(controller.signal);
  });

  it('rejects with AbortError when the signal is aborted mid-stream', async () => {
    const { response, push, getCancelCalled } = makeControllableSseResponse();
    // jsdom fetch doesn't observe `init.signal` for us, so we simulate
    // the browser behaviour: when signal fires, reject the fetch
    // promise (or in our case the body read path) with an AbortError.
    fetchSpy.mockImplementation(async (_url, init: FetchInit) => {
      // Hook the signal onto the stream so abort propagates to cancel.
      init.signal?.addEventListener('abort', () => {
        // Real browsers cancel the body reader when the fetch is
        // aborted after response headers have been received.  Emulate
        // that here so the reader.read() in llm-client sees it.
        (response.body as ReadableStream<Uint8Array> | null)
          ?.cancel(new DOMException('aborted by signal', 'AbortError'))
          .catch(() => {});
      });
      return response;
    });

    const controller = new AbortController();
    const { callLLMDirectFull } = await import('./llm-client');

    // Emit one token, then fire the abort before DONE/close.
    push('data: {"choices":[{"delta":{"content":"par"}}]}\n\n');

    const callP = callLLMDirectFull(
      [{ role: 'user', content: 'long' }],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'test' },
      controller.signal,
    );

    // Give the event loop a tick to enter reader.read() before aborting
    await Promise.resolve();
    controller.abort();

    await expect(callP).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCancelCalled()).toBe(true);
  });
});

describe('runExtractionPipeline · AbortSignal threading (soul-extraction.ts)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('invokes onCancelled (not onComplete) when caller aborts mid-step', async () => {
    // Mock prompt modules so `getPrompt()` never touches questionnaire
    // internals — we only want to test the pipeline's cancel contract,
    // not prompt composition.
    vi.doMock('./prompts/extraction-prompts', () => ({
      soulPrompt: () => 'mock-soul',
      voicePrompt: () => 'mock-voice',
      emotionalPatternsPrompt: () => 'mock-emotional',
      memoryPrompt: () => 'mock-memory',
      relationshipPrompt: () => 'mock-relationship',
    }));
    vi.doMock('./prompts/enrichment-prompts', () => ({
      enrichSoulPrompt: () => 'mock',
      enrichVoicePrompt: () => 'mock',
      enrichEmotionalPatternsPrompt: () => 'mock',
      enrichMemoryPrompt: () => 'mock',
      enrichRelationshipPrompt: () => 'mock',
    }));

    // Mock the low-level LLM client so each step rejects promptly with
    // AbortError once the signal fires, mimicking the wired-through
    // fetch cancellation proved above.  Isolates this test to the
    // pipeline cancel dispatch contract itself.
    vi.doMock('./llm-client', () => ({
      callLLMDirectFull: vi.fn((
        _messages: unknown,
        _options: unknown,
        signal?: AbortSignal,
      ) => {
        return new Promise<string>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
          setTimeout(() => _resolve('noop'), 5_000);
        });
      }),
    }));

    const { extractSoul } = await import('./soul-extraction');

    const onProgress = vi.fn();
    const onDocGenerated = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onCancelled = vi.fn();
    const controller = new AbortController();

    const questionnaire = {} as unknown as Parameters<typeof extractSoul>[0];

    const p = extractSoul(
      questionnaire,
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'test' },
      {
        onProgress,
        onDocGenerated,
        onComplete,
        onError,
        onCancelled,
      },
      controller.signal,
    );

    // Let the pipeline advance into callLLMDirectFull and register the
    // 'abort' listener, then fire the abort.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await p;

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // First step should at least have announced progress before abort.
    expect(onProgress).toHaveBeenCalled();
  });
});

// ============================================================
// SU-ITER-092-batch3 · A2-Concern-1 close-out
// (updated for SU-ITER-093: proxy-only transport)
//
// Historically `callLLMDirect` had a two-stage fetch ladder: try
// the upstream provider directly, then fall back to `/api/llm/chat`
// on a CORS-shaped TypeError.  SU-ITER-093 collapsed that ladder
// into a single proxy call to honour CSP `connect-src 'self'`, so
// the only remaining catch-block classification decision is:
// "is this thrown error a deliberate abort, or something else?"
//
// This suite pins both sides of that decision:
//   1. A non-abort TypeError from the proxy fetch must propagate
//      untouched and must NOT trip the caller's AbortSignal.
//   2. A deliberate pre-abort must surface as AbortError with
//      exactly one fetch attempt (no hidden retry).
// ============================================================

describe('callLLMDirect · proxy fetch error classification', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // The `runExtractionPipeline` suite above registers
    // `vi.doMock('./llm-client', ...)` which persists across suites,
    // so explicitly un-mock before importing so we exercise the REAL
    // llm-client code paths under test.
    vi.doUnmock('./llm-client');
    vi.doUnmock('./prompts/extraction-prompts');
    vi.doUnmock('./prompts/enrichment-prompts');
    vi.resetModules();
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('propagates a non-abort TypeError from the proxy without retrying (signal untouched)', async () => {
    // SU-ITER-093 enforced `connect-src 'self'` which collapsed the
    // old "try direct → fall back to proxy on CORS" ladder into a
    // single proxy call (see `callViaProxy` in llm-client.ts).  The
    // invariant this test now pins is the symmetric opposite of the
    // deliberate-abort path below: if the proxy's own fetch rejects
    // with a non-abort TypeError (DNS failure, worker crash, …) the
    // error must propagate to the caller rather than being swallowed
    // as a silent abort — and the caller's signal must stay pristine
    // so they can still retry deliberately.
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const controller = new AbortController();
    const { callLLMDirect } = await import('./llm-client');

    await expect(
      callLLMDirect(
        [{ role: 'user', content: 'ping' }],
        { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'test' },
        undefined,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(TypeError);

    // Exactly one fetch attempt (the proxy); no hidden retry ladder.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/llm/chat');
    // Critical invariant: a CORS-style TypeError must NOT be
    // misread as a deliberate abort. The caller's signal must stay
    // pristine so they can still cancel or retry later.
    expect(controller.signal.aborted).toBe(false);
  });

  it('deliberate abort during direct fetch is NOT retried via proxy', async () => {
    // Belt-and-suspenders companion: if fetch throws while the signal
    // is already aborted, we must re-throw rather than fall through to
    // the TypeError-fallback branch.  Pins the ordering between the
    // `signal.aborted` check and the `instanceof TypeError` check in
    // llm-client's catch block.
    fetchSpy.mockImplementationOnce(async (_url, init: FetchInit) => {
      // Emulate browser fetch rejecting with AbortError once the signal
      // has fired.
      if (init.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      throw new TypeError('Failed to fetch'); // fallback if race lost
    });

    const controller = new AbortController();
    controller.abort();
    const { callLLMDirect } = await import('./llm-client');

    await expect(
      callLLMDirect(
        [{ role: 'user', content: 'ping' }],
        { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'test' },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Proxy must NOT have been attempted.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
