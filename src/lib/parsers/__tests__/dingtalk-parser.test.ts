import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDingtalk } from '../dingtalk-parser';

function makeFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('DingTalk Parser', () => {
  it('parses golden sample TXT correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'dingtalk-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'dingtalk-chat.txt');
    const result = await parseDingtalk(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.platform).toBe('dingtalk');
    expect(result.data.format).toBe('txt');
    expect(result.data.messages.length).toBeGreaterThanOrEqual(3);
    expect(result.data.participants).toContain('王五');
    expect(result.data.participants).toContain('赵六');
  });

  it('detects file placeholders', async () => {
    const content = `王五 2024-01-15 09:02:00\n[文件]`;
    const file = makeFile(content, 'test.txt');
    const result = await parseDingtalk(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].type).toBe('file');
  });

  it('handles UTF-8 BOM', async () => {
    const content = `\uFEFF王五 2024-01-15 09:00:00\n大家早上好`;
    const file = makeFile(content, 'bom.txt');
    const result = await parseDingtalk(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages.length).toBe(1);
    expect(result.data.participants).toContain('王五');
  });

  it('returns error for empty file', async () => {
    const file = makeFile('', 'empty.txt');
    const result = await parseDingtalk(file);
    expect(result.success).toBe(false);
  });

  it('computes time range', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'dingtalk-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'dingtalk-chat.txt');
    const result = await parseDingtalk(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.timeRange.earliest).not.toBeNull();
    expect(result.data.timeRange.latest).not.toBeNull();
  });
});
