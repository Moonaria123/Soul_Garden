import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseWechat } from '../wechat-parser';

function makeFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('WeChat Parser', () => {
  it('parses golden sample TXT correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'wechat-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'wechat-chat.txt');
    const result = await parseWechat(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.platform).toBe('wechat');
    expect(result.data.format).toBe('txt');
    expect(result.data.messages.length).toBeGreaterThanOrEqual(5);
    expect(result.data.participants).toContain('张三');
    expect(result.data.participants).toContain('李四');
  });

  it('identifies media placeholders', async () => {
    const content = `2024-01-15 14:32:00\n张三\n[图片]`;
    const file = makeFile(content, 'test.txt');
    const result = await parseWechat(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].type).toBe('image');
  });

  it('identifies system messages', async () => {
    const content = `2024-01-15 14:33:00\n系统消息\n张三 撤回了一条消息`;
    const file = makeFile(content, 'test.txt');
    const result = await parseWechat(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].type).toBe('system');
  });

  it('returns error for empty file', async () => {
    const file = makeFile('', 'empty.txt');
    const result = await parseWechat(file);
    expect(result.success).toBe(false);
  });

  it('handles multi-line message content', async () => {
    const content = `2024-01-15 14:30:00\n张三\n第一行\n第二行\n第三行`;
    const file = makeFile(content, 'multiline.txt');
    const result = await parseWechat(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].content).toContain('第一行');
    expect(result.data.messages[0].content).toContain('第三行');
  });

  it('computes time range correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'wechat-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'wechat-chat.txt');
    const result = await parseWechat(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.timeRange.earliest).not.toBeNull();
    expect(result.data.timeRange.latest).not.toBeNull();
    expect(result.data.timeRange.earliest!.getTime()).toBeLessThanOrEqual(
      result.data.timeRange.latest!.getTime(),
    );
  });
});
