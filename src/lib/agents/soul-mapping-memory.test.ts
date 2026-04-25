import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './soul-mapping';
import { DEFAULT_CHAT_REPLY_STYLE } from '@/types';
import type { SoulDocs } from '@/types';

describe('buildSystemPrompt — SU-044 conversation memory block', () => {
  const soulDocs: SoulDocs = {
    SOUL: 'soul-body',
    VOICE: '',
    EMOTIONAL_PATTERNS: '',
    MEMORY: 'material-memory',
    RELATIONSHIP: 'rel-block',
  };

  it('places dialogue-period block after editable MEMORY and before RELATIONSHIP', () => {
    const block = '## 对话期持续记忆\n\ndialogue-only';
    const prompt = buildSystemPrompt(
      'Test',
      soulDocs,
      [],
      undefined,
      null,
      undefined,
      DEFAULT_CHAT_REPLY_STYLE,
      block,
    );
    const iMat = prompt.indexOf('material-memory');
    const iDlg = prompt.indexOf('dialogue-only');
    const iRel = prompt.indexOf('rel-block');
    expect(iMat).toBeGreaterThanOrEqual(0);
    expect(iDlg).toBeGreaterThan(iMat);
    expect(iRel).toBeGreaterThan(iDlg);
  });
});
