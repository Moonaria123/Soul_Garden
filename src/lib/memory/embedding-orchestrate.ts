/**
 * SU-044 Phase 3 — route embedding calls to local or cloud from persisted settings.
 */

import { parseLocalModelIdFromActiveKey } from '@/lib/memory/embedding-constants';
import { loadEmbeddingSettingsResolved } from '@/lib/store/embedding-config-store';

export async function embedPassageForStorage(
  text: string,
  signal?: AbortSignal,
): Promise<{ modelKey: string; vector: number[] } | null> {
  const s = await loadEmbeddingSettingsResolved();
  if (s.mode === 'off') return null;
  if (s.mode === 'local') {
    const modelId = parseLocalModelIdFromActiveKey(s.activeModelKey);
    if (!modelId) return null;
    const { embedTextLocalPassage } = await import('@/lib/memory/embedding-local');
    const vector = await embedTextLocalPassage(text, modelId, undefined, s.localWeightSource);
    return { modelKey: s.activeModelKey, vector };
  }
  const { embedTextCloud } = await import('@/lib/memory/embedding-cloud');
  const vector = await embedTextCloud({
    baseURL: s.baseURL,
    apiKey: s.apiKey,
    model: s.modelId,
    input: text,
    signal,
  });
  return { modelKey: s.activeModelKey, vector };
}

export async function embedQueryForSearch(
  text: string,
  signal?: AbortSignal,
): Promise<{ modelKey: string; vector: number[] } | null> {
  const s = await loadEmbeddingSettingsResolved();
  if (s.mode === 'off') return null;
  if (s.mode === 'local') {
    const modelId = parseLocalModelIdFromActiveKey(s.activeModelKey);
    if (!modelId) return null;
    const { embedTextLocalQuery } = await import('@/lib/memory/embedding-local');
    const vector = await embedTextLocalQuery(text, modelId, undefined, s.localWeightSource);
    return { modelKey: s.activeModelKey, vector };
  }
  const { embedTextCloud } = await import('@/lib/memory/embedding-cloud');
  const vector = await embedTextCloud({
    baseURL: s.baseURL,
    apiKey: s.apiKey,
    model: s.modelId,
    input: text,
    signal,
  });
  return { modelKey: s.activeModelKey, vector };
}
