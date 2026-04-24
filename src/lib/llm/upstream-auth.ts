// ============================================================
// Upstream auth headers for GET /models probes (SU-ITER-030)
// Azure OpenAI uses `api-key`, not `Authorization: Bearer`.
// ============================================================

import type { ApiType } from '@/types';
import { isAzureOpenAiHost } from '@/lib/llm/upstream-url';

/**
 * Headers for GET models list — must match chat proxy expectations per host.
 */
export function buildModelsProbeHeaders(
  apiKey: string,
  apiType: ApiType,
  baseUrl: string
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isAzureOpenAiHost(baseUrl)) {
    headers['api-key'] = apiKey;
    return headers;
  }

  if (apiType === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}
