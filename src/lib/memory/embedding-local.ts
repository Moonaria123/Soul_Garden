/**
 * SU-044 Phase 3 — lazy-loaded @xenova/transformers (not in initial bundle).
 */

import {
  type LocalWeightSource,
  getLocalEmbeddingModelMeta,
  getRemoteHostForWeightSource,
  normalizeLocalEmbedInput,
  DEFAULT_LOCAL_WEIGHT_SOURCE,
  xenovaHubProgressToUnit,
} from '@/lib/memory/embedding-constants';

type PipeFn = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<unknown>;

/** Cache by model + weight source (remoteHost). */
const pipeByKey = new Map<string, Promise<PipeFn>>();

function cacheKey(modelId: string, weightSource: LocalWeightSource): string {
  return `${modelId}@@${weightSource}`;
}

export type LocalEmbedProgress = (state: { progress?: number; status?: string }) => void;

/** Drop cached pipelines (e.g. after settings "clear model cache" or model switch). */
export function resetLocalEmbeddingPipelineCache(): void {
  pipeByKey.clear();
}

function tensorLikeToVector(result: unknown): number[] {
  if (result == null) {
    throw new Error('Embedding model returned no output; the export may be incompatible.');
  }
  if (result instanceof Float32Array) {
    return Array.from(result);
  }
  if (typeof result === 'object' && result !== null && 'data' in result) {
    const raw = (result as { data: unknown }).data;
    if (raw instanceof Float32Array) {
      return Array.from(raw);
    }
    if (raw instanceof Float64Array) {
      return Array.from(raw);
    }
  }
  throw new Error('Unexpected embedding tensor shape; try another model or rebuild the index.');
}

function wrapProgress(onProgress?: LocalEmbedProgress): ((data: unknown) => void) | null {
  if (!onProgress) return null;
  return (data: unknown) => {
    try {
      if (data == null || typeof data !== 'object') return;
      const d = data as Record<string, unknown>;
      const rawP = typeof d.progress === 'number' && Number.isFinite(d.progress) ? d.progress : undefined;
      const progress = rawP === undefined ? undefined : xenovaHubProgressToUnit(rawP);
      const status = typeof d.status === 'string' ? d.status : undefined;
      onProgress({ progress, status });
    } catch {
      /* ignore malformed hub progress payloads */
    }
  };
}

async function getPipe(
  modelId: string,
  onProgress: LocalEmbedProgress | undefined,
  weightSource: LocalWeightSource,
): Promise<PipeFn> {
  const key = cacheKey(modelId, weightSource);
  let promise = pipeByKey.get(key);
  if (!promise) {
    promise = (async () => {
      if (weightSource === 'hfMirror') {
        const { installHfMirrorFetchProxy } = await import('@/lib/memory/hf-mirror-fetch-proxy');
        installHfMirrorFetchProxy();
      }
      const mod = await import('@xenova/transformers');
      const pipeline = mod.pipeline;
      const env = mod.env;
      if (env && typeof env === 'object') {
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.remoteHost = getRemoteHostForWeightSource(weightSource);
      }
      const progressCb = wrapProgress(onProgress);
      const pipe = await pipeline('feature-extraction', modelId, {
        quantized: true,
        progress_callback: progressCb ?? undefined,
      });
      return pipe as PipeFn;
    })();
    pipeByKey.set(key, promise);
  }
  return promise;
}

/** Indexed text (passage) — use for stored memory snippets. */
export async function embedTextLocalPassage(
  text: string,
  modelId: string,
  onProgress?: LocalEmbedProgress,
  weightSource: LocalWeightSource = DEFAULT_LOCAL_WEIGHT_SOURCE,
): Promise<number[]> {
  const meta = getLocalEmbeddingModelMeta(modelId);
  const family = meta?.family ?? 'symmetric';
  const pipe = await getPipe(modelId, onProgress, weightSource);
  const input = normalizeLocalEmbedInput(text, 'passage', family);
  const out = await pipe(input, { pooling: 'mean', normalize: true });
  return tensorLikeToVector(out);
}

/** Query string — use for live user message retrieval. */
export async function embedTextLocalQuery(
  text: string,
  modelId: string,
  onProgress?: LocalEmbedProgress,
  weightSource: LocalWeightSource = DEFAULT_LOCAL_WEIGHT_SOURCE,
): Promise<number[]> {
  const meta = getLocalEmbeddingModelMeta(modelId);
  const family = meta?.family ?? 'symmetric';
  const pipe = await getPipe(modelId, onProgress, weightSource);
  const input = normalizeLocalEmbedInput(text, 'query', family);
  const out = await pipe(input, { pooling: 'mean', normalize: true });
  return tensorLikeToVector(out);
}

/**
 * Warm download / compile — call from settings "one-click install".
 */
export async function downloadLocalEmbeddingModel(
  modelId: string,
  onProgress?: LocalEmbedProgress,
  weightSource: LocalWeightSource = DEFAULT_LOCAL_WEIGHT_SOURCE,
): Promise<void> {
  resetLocalEmbeddingPipelineCache();
  const pipe = await getPipe(modelId, onProgress, weightSource);
  const meta = getLocalEmbeddingModelMeta(modelId);
  const family = meta?.family ?? 'symmetric';
  const warm = normalizeLocalEmbedInput('warmup', 'passage', family);
  const out = await pipe(warm, { pooling: 'mean', normalize: true });
  tensorLikeToVector(out);
}
