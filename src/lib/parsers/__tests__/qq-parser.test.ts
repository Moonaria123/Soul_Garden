import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseQQ } from '../qq-parser';

function makeFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('QQ Parser', () => {
  it('parses golden sample TXT correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'qq-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'qq-chat.txt');
    const result = await parseQQ(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.platform).toBe('qq');
    expect(result.data.format).toBe('txt');
    expect(result.data.messages.length).toBeGreaterThanOrEqual(3);
    expect(result.data.participants).toContain('好友A');
    expect(result.data.participants).toContain('用户B');
  });

  it('detects media placeholders', async () => {
    const content = `Header\n=====\n2024-01-15 10:32:00 上午 好友A(12345678)\n[图片]`;
    const file = makeFile(content, 'test.txt');
    const result = await parseQQ(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].type).toBe('image');
  });

  it('handles AM/PM period markers', async () => {
    const content = `Header\n=====\n2024-01-15 2:30:00 PM TestUser(999)\nHello`;
    const file = makeFile(content, 'test.txt');
    const result = await parseQQ(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const ts = result.data.messages[0].timestamp;
    expect(ts).not.toBeNull();
    expect(ts!.getHours()).toBe(14);
  });

  it('returns error for empty file', async () => {
    const file = makeFile('', 'empty.txt');
    const result = await parseQQ(file);
    expect(result.success).toBe(false);
  });

  it('computes time range', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'qq-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'qq-chat.txt');
    const result = await parseQQ(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.timeRange.earliest).not.toBeNull();
  });
});
