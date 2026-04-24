import { describe, it, expect } from 'vitest';
import { formatChatAsText } from '../chat-to-material';
import type { ParsedChatHistory } from '../chat-parser-types';

function makeParsed(overrides?: Partial<ParsedChatHistory>): ParsedChatHistory {
  return {
    platform: 'wechat',
    format: 'txt',
    messages: [
      { timestamp: new Date('2024-01-15T14:30:00'), sender: 'Alice', content: 'Hello', type: 'text' },
      { timestamp: new Date('2024-01-15T14:31:00'), sender: 'Bob', content: 'Hi there', type: 'text' },
      { timestamp: null, sender: 'System', content: 'Alice joined', type: 'system' },
    ],
    participants: ['Alice', 'Bob'],
    timeRange: {
      earliest: new Date('2024-01-15T14:30:00'),
      latest: new Date('2024-01-15T14:31:00'),
    },
    metadata: {
      totalParsed: 3,
      totalSkipped: 0,
      warnings: [],
    },
    ...overrides,
  };
}

describe('formatChatAsText', () => {
  it('formats all messages by default', () => {
    const text = formatChatAsText(makeParsed());
    expect(text).toContain('Alice: Hello');
    expect(text).toContain('Bob: Hi there');
    expect(text).toContain('System: Alice joined');
  });

  it('filters by target speakers', () => {
    const text = formatChatAsText(makeParsed(), { targetSpeakers: ['Alice'] });
    expect(text).toContain('Alice: Hello');
    expect(text).not.toContain('Bob: Hi there');
    expect(text).toContain('System: Alice joined');
  });

  it('excludes system messages when requested', () => {
    const text = formatChatAsText(makeParsed(), { excludeSystemMessages: true });
    expect(text).toContain('Alice: Hello');
    expect(text).not.toContain('Alice joined');
  });

  it('limits message count', () => {
    const text = formatChatAsText(makeParsed(), { maxMessages: 1 });
    const lines = text.split('\n');
    expect(lines).toHaveLength(1);
  });

  it('formats timestamps correctly', () => {
    const text = formatChatAsText(makeParsed());
    expect(text).toMatch(/\[2024-01-15 14:30\]/);
  });
});
