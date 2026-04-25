import { describe, it, expect } from 'vitest';
import {
  prefixForE5Query,
  prefixForE5Passage,
  buildCloudEmbeddingModelKey,
  buildLocalEmbeddingModelKey,
  parseLocalModelIdFromActiveKey,
  normalizeLocalEmbedInput,
  getRemoteHostForWeightSource,
  DEFAULT_LOCAL_WEIGHT_SOURCE,
  xenovaHubProgressToUnit,
} from './embedding-constants';

describe('embedding-constants', () => {
  it('prefixes E5 query/passage when missing', () => {
    expect(prefixForE5Query('hello')).toBe('query: hello');
    expect(prefixForE5Passage('world')).toBe('passage: world');
  });

  it('does not double-prefix', () => {
    expect(prefixForE5Query('query: x')).toBe('query: x');
    expect(prefixForE5Passage('passage: y')).toBe('passage: y');
  });

  it('buildCloudEmbeddingModelKey normalizes URL', () => {
    expect(buildCloudEmbeddingModelKey('https://a.com/v1/', 'm1')).toBe('cloud:https://a.com/v1#m1');
  });

  it('buildLocalEmbeddingModelKey and parse round-trip', () => {
    const id = 'Xenova/multilingual-e5-small';
    const key = buildLocalEmbeddingModelKey(id);
    expect(key).toBe(`local:${id}`);
    expect(parseLocalModelIdFromActiveKey(key)).toBe(id);
    expect(parseLocalModelIdFromActiveKey('cloud:x')).toBeNull();
  });

  it('normalizeLocalEmbedInput uses E5 vs symmetric', () => {
    expect(normalizeLocalEmbedInput('hi', 'query', 'e5')).toBe('query: hi');
    expect(normalizeLocalEmbedInput('hi', 'passage', 'e5')).toBe('passage: hi');
    expect(normalizeLocalEmbedInput('  hi  ', 'query', 'symmetric')).toBe('hi');
  });

  it('getRemoteHostForWeightSource', () => {
    expect(getRemoteHostForWeightSource('huggingface')).toContain('huggingface.co');
    expect(getRemoteHostForWeightSource('hfMirror')).toContain('hf-mirror.com');
  });

  it('defaults local weight source to official hub', () => {
    expect(DEFAULT_LOCAL_WEIGHT_SOURCE).toBe('huggingface');
  });

  it('xenovaHubProgressToUnit maps 0-100 and 0-1', () => {
    expect(xenovaHubProgressToUnit(0.5)).toBe(0.5);
    expect(xenovaHubProgressToUnit(50)).toBe(0.5);
    expect(xenovaHubProgressToUnit(100)).toBe(1);
  });
});
