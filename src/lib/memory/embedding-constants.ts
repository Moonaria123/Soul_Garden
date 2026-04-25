/**
 * SU-044 Phase 3 — local embedding catalog & keys (weights loaded on demand).
 */

/** Where Transformers.js fetches ONNX files (same repo id, different host). */
export type LocalWeightSource = 'huggingface' | 'hfMirror';

/** Official Hub — must end with / to match @xenova/transformers `env.remoteHost` */
export const HUGGINGFACE_REMOTE_HOST = 'https://huggingface.co/' as const;
/** Community mirror; often faster in mainland China. See https://hf-mirror.com/ */
export const HF_MIRROR_REMOTE_HOST = 'https://hf-mirror.com/' as const;

export const DEFAULT_LOCAL_WEIGHT_SOURCE: LocalWeightSource = 'huggingface';

const WEIGHT_SOURCE_HOST: Record<LocalWeightSource, string> = {
  huggingface: HUGGINGFACE_REMOTE_HOST,
  hfMirror: HF_MIRROR_REMOTE_HOST,
};

export function getRemoteHostForWeightSource(source: LocalWeightSource): string {
  return WEIGHT_SOURCE_HOST[source] ?? HUGGINGFACE_REMOTE_HOST;
}

/**
 * Xenova hub file downloads report `progress` as 0-100; treat 0-1 as fraction for UI.
 */
export function xenovaHubProgressToUnit(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (raw <= 1) return Math.min(1, raw);
  if (raw <= 100) return Math.min(1, raw / 100);
  return 1;
}

export const ALLOWED_LOCAL_WEIGHT_SOURCES = new Set<LocalWeightSource>(['huggingface', 'hfMirror']);

/** How query vs passage text is prepared before the local pipeline. */
export type LocalEmbeddingFamily = 'e5' | 'symmetric';

export type LocalCatalogSlug =
  | 'e5Small'
  | 'e5Base'
  | 'mpMinilmL12'
  | 'minilmL6'
  | 'gteSmall'
  | 'jinaBaseZh'
  | 'bgeSmallZh';

export interface LocalEmbeddingModelOption {
  /** Hugging Face model id for Transformers.js */
  id: string;
  slug: LocalCatalogSlug;
  family: LocalEmbeddingFamily;
  /** Rough size tier for UI ordering (not exact MB). */
  sizeTier: 'S' | 'M' | 'L';
  /** Highlight in UI copy as Chinese-optimized (same Hub path; works with hf-mirror). */
  zhOptimized?: boolean;
}

/**
 * Curated Xenova ONNX models for browser feature-extraction.
 * E5: query/passage prefixes. Others: symmetric (trim / raw).
 */
export const LOCAL_EMBEDDING_MODEL_CATALOG: readonly LocalEmbeddingModelOption[] = [
  {
    id: 'Xenova/multilingual-e5-small',
    slug: 'e5Small',
    family: 'e5',
    sizeTier: 'M',
  },
  {
    id: 'Xenova/multilingual-e5-base',
    slug: 'e5Base',
    family: 'e5',
    sizeTier: 'L',
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    slug: 'mpMinilmL12',
    family: 'symmetric',
    sizeTier: 'M',
  },
  {
    id: 'Xenova/jina-embeddings-v2-base-zh',
    slug: 'jinaBaseZh',
    family: 'symmetric',
    sizeTier: 'M',
    zhOptimized: true,
  },
  {
    id: 'Xenova/bge-small-zh-v1.5',
    slug: 'bgeSmallZh',
    family: 'symmetric',
    sizeTier: 'S',
    zhOptimized: true,
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    slug: 'minilmL6',
    family: 'symmetric',
    sizeTier: 'S',
  },
  {
    id: 'Xenova/gte-small',
    slug: 'gteSmall',
    family: 'symmetric',
    sizeTier: 'S',
  },
] as const;

const CATALOG_BY_ID = new Map(LOCAL_EMBEDDING_MODEL_CATALOG.map((m) => [m.id, m]));

export const DEFAULT_LOCAL_EMBEDDING_MODEL_ID = LOCAL_EMBEDDING_MODEL_CATALOG[0].id;

export const ALLOWED_LOCAL_EMBEDDING_MODEL_IDS = new Set(
  LOCAL_EMBEDDING_MODEL_CATALOG.map((m) => m.id),
);

export function buildLocalEmbeddingModelKey(modelId: string): string {
  return `local:${modelId}`;
}

/** Strip `local:` prefix; returns null if not a local key. */
export function parseLocalModelIdFromActiveKey(activeModelKey: string): string | null {
  if (!activeModelKey.startsWith('local:')) return null;
  const id = activeModelKey.slice('local:'.length).trim();
  return id || null;
}

export function getLocalEmbeddingModelMeta(modelId: string): LocalEmbeddingModelOption | undefined {
  return CATALOG_BY_ID.get(modelId);
}

export function normalizeLocalEmbedInput(
  text: string,
  role: 'query' | 'passage',
  family: LocalEmbeddingFamily,
): string {
  if (family === 'e5') {
    return role === 'query' ? prefixForE5Query(text) : prefixForE5Passage(text);
  }
  const t = text.trim();
  return t || ' ';
}

/**
 * E5 models expect "query: ..." / "passage: ..." prefixes for best retrieval quality.
 */
export function prefixForE5Query(text: string): string {
  const t = text.trim();
  if (!t) return 'query: ';
  return t.startsWith('query:') || t.startsWith('passage:') ? t : `query: ${t}`;
}

export function prefixForE5Passage(text: string): string {
  const t = text.trim();
  if (!t) return 'passage: ';
  return t.startsWith('query:') || t.startsWith('passage:') ? t : `passage: ${t}`;
}

/** Build stable key for cloud mode rows (URL + model identity). */
export function buildCloudEmbeddingModelKey(baseURL: string, modelId: string): string {
  const u = baseURL.trim().replace(/\/+$/, '');
  const m = modelId.trim();
  return `cloud:${u}#${m}`;
}

/** @deprecated Use buildLocalEmbeddingModelKey(DEFAULT_LOCAL_EMBEDDING_MODEL_ID) */
export const LOCAL_EMBEDDING_MODEL_ID = DEFAULT_LOCAL_EMBEDDING_MODEL_ID;

/** @deprecated Use buildLocalEmbeddingModelKey(...) */
export const LOCAL_EMBEDDING_MODEL_KEY = buildLocalEmbeddingModelKey(DEFAULT_LOCAL_EMBEDDING_MODEL_ID);
