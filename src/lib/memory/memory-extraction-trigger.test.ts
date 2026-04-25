import { describe, it, expect } from 'vitest';
import { shouldTriggerMemoryExtraction } from './memory-extraction';
import { CHAT_CONSTANTS } from '@/types';

describe('shouldTriggerMemoryExtraction', () => {
  const step = CHAT_CONSTANTS.MEMORY_EXTRACT_TRIGGER_COUNT;

  it('returns false below first threshold', () => {
    expect(shouldTriggerMemoryExtraction(step - 1, 0)).toBe(false);
  });

  it('fires when message count advances by step from watermark', () => {
    expect(shouldTriggerMemoryExtraction(step, 0)).toBe(true);
    expect(shouldTriggerMemoryExtraction(step * 2, step)).toBe(true);
    expect(shouldTriggerMemoryExtraction(step * 2 - 1, step)).toBe(false);
  });
});
