/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · `agents/soul-extraction.ts` coverage.  The
 * abort-propagation tests already exercised the first-step + cancel
 * branch.  This file covers the remaining paths:
 *   1. successful 5-step extractSoul → onComplete with all SOUL_DOC keys populated
 *   2. LLM error (non-abort) mid-pipeline → onError routed, subsequent steps skipped
 *   3. enrichSoul path (separate top-level function, distinct steps)
 *   4. textMaterials + webSearchMaterials merged into mats path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prompt modules deterministically so we only test pipeline behaviour
vi.mock('./prompts/extraction-prompts', () => ({
  soulPrompt: vi.fn((_q, mats) => `soul(${mats ? mats.length : 0})`),
  voicePrompt: vi.fn(() => 'voice'),
  emotionalPatternsPrompt: vi.fn(() => 'emotional'),
  memoryPrompt: vi.fn(() => 'memory'),
  relationshipPrompt: vi.fn(() => 'relationship'),
}));
vi.mock('./prompts/enrichment-prompts', () => ({
  enrichSoulPrompt: vi.fn(() => 'enrich-soul'),
  enrichVoicePrompt: vi.fn(() => 'enrich-voice'),
  enrichEmotionalPatternsPrompt: vi.fn(() => 'enrich-emotional'),
  enrichMemoryPrompt: vi.fn(() => 'enrich-memory'),
  enrichRelationshipPrompt: vi.fn(() => 'enrich-relationship'),
}));

// Hoisted so all tests share one mock we can re-arm per case.
const llmClientMock = vi.hoisted(() => ({
  callLLMDirectFull: vi.fn<
    (messages: unknown, options: unknown, signal?: AbortSignal) => Promise<string>
  >(),
}));
vi.mock('./llm-client', () => llmClientMock);

import { extractSoul, enrichSoul } from './soul-extraction';
import * as promptsMod from './prompts/extraction-prompts';

describe('extractSoul · success path', () => {
  beforeEach(() => {
    llmClientMock.callLLMDirectFull.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it('runs 5 serial steps, writes docs, fires onComplete', async () => {
    // Each step returns a distinct body so we can verify docs[key] wiring.
    const outputs = ['SOUL-body', 'VOICE-body', 'EMO-body', 'MEM-body', 'REL-body'];
    let call = 0;
    llmClientMock.callLLMDirectFull.mockImplementation(async () => outputs[call++]);

    const onProgress = vi.fn();
    const onDocGenerated = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    const result = await extractSoul(
      {} as Parameters<typeof extractSoul>[0],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      { onProgress, onDocGenerated, onComplete, onError },
    );

    expect(llmClientMock.callLLMDirectFull).toHaveBeenCalledTimes(5);
    expect(result.SOUL).toBe('SOUL-body');
    expect(result.VOICE).toBe('VOICE-body');
    expect(result.EMOTIONAL_PATTERNS).toBe('EMO-body');
    expect(result.MEMORY).toBe('MEM-body');
    expect(result.RELATIONSHIP).toBe('REL-body');

    // onDocGenerated fires once per completed step.
    expect(onDocGenerated).toHaveBeenCalledTimes(5);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // onProgress fires once per-step PLUS the final "complete" tick.
    const progressSteps = onProgress.mock.calls.map((c) => c[0]);
    expect(progressSteps).toEqual([
      'analyzing_personality',
      'analyzing_voice',
      'analyzing_emotions',
      'building_memory',
      'defining_relationship',
      'complete',
    ]);
  });

  it('merges webSearchMaterials + textMaterials before passing to soulPrompt', async () => {
    llmClientMock.callLLMDirectFull.mockResolvedValue('x');
    await extractSoul(
      {} as Parameters<typeof extractSoul>[0],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      {
        onProgress: vi.fn(),
        onDocGenerated: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      undefined,
      [{ text: 't1' }] as unknown as Parameters<typeof extractSoul>[4],
      [{ text: 'w1' }, { text: 'w2' }] as unknown as Parameters<typeof extractSoul>[5],
    );
    // soulPrompt called with (questionnaire, mats) — mats should have 3 entries.
    const call = vi.mocked(promptsMod.soulPrompt).mock.calls[0];
    expect(call[1]).toHaveLength(3);
  });

  it('trims step output before writing into docs', async () => {
    llmClientMock.callLLMDirectFull.mockResolvedValue('   padded   \n');
    const onDocGenerated = vi.fn();
    await extractSoul(
      {} as Parameters<typeof extractSoul>[0],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      {
        onProgress: vi.fn(),
        onDocGenerated,
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );
    // All onDocGenerated invocations should receive the trimmed value.
    for (const c of onDocGenerated.mock.calls) {
      expect(c[1]).toBe('padded');
    }
  });
});

describe('extractSoul · LLM error (non-abort)', () => {
  beforeEach(() => {
    llmClientMock.callLLMDirectFull.mockReset();
    vi.clearAllMocks();
  });

  it('invokes onError and halts at the failing step, not onComplete', async () => {
    let call = 0;
    llmClientMock.callLLMDirectFull.mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error('LLM boom');
      return 'ok';
    });

    const onProgress = vi.fn();
    const onDocGenerated = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await extractSoul(
      {} as Parameters<typeof extractSoul>[0],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      { onProgress, onDocGenerated, onComplete, onError },
    );

    // Step 1 wrote its doc, step 2 threw, steps 3-5 never ran.
    expect(onDocGenerated).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('analyzing_voice');
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('coerces non-Error rejection into an Error before onError', async () => {
    llmClientMock.callLLMDirectFull.mockRejectedValue('a string, not an Error');
    const onError = vi.fn();
    await extractSoul(
      {} as Parameters<typeof extractSoul>[0],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      {
        onProgress: vi.fn(),
        onDocGenerated: vi.fn(),
        onComplete: vi.fn(),
        onError,
      },
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][1] as Error).message).toBe('a string, not an Error');
  });
});

describe('enrichSoul · 5-step enrichment pipeline', () => {
  beforeEach(() => {
    llmClientMock.callLLMDirectFull.mockReset();
    vi.clearAllMocks();
  });

  it('preserves existing docs as seed, overwrites each one via enrichment prompt', async () => {
    const existing = {
      SOUL: 'OLD-SOUL',
      VOICE: 'OLD-VOICE',
      EMOTIONAL_PATTERNS: 'OLD-EMO',
      MEMORY: 'OLD-MEM',
      RELATIONSHIP: 'OLD-REL',
    };
    llmClientMock.callLLMDirectFull.mockImplementation(async () => 'NEW-body');

    const onComplete = vi.fn();
    const result = await enrichSoul(
      existing,
      {} as Parameters<typeof enrichSoul>[1],
      [{ text: 'fresh-evidence' }] as unknown as Parameters<typeof enrichSoul>[2],
      { apiKey: 'k', baseURL: 'https://example.invalid/v1', model: 'm' },
      {
        onProgress: vi.fn(),
        onDocGenerated: vi.fn(),
        onComplete,
        onError: vi.fn(),
      },
    );

    expect(llmClientMock.callLLMDirectFull).toHaveBeenCalledTimes(5);
    expect(result.SOUL).toBe('NEW-body');
    expect(result.VOICE).toBe('NEW-body');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
