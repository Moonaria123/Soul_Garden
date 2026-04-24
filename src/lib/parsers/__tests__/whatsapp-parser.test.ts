import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseWhatsApp } from '../whatsapp-parser';

function makeFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('WhatsApp Parser', () => {
  it('parses golden sample TXT correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'whatsapp-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'whatsapp-chat.txt');
    const result = await parseWhatsApp(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.platform).toBe('whatsapp');
    expect(result.data.format).toBe('txt');
    expect(result.data.messages.length).toBeGreaterThanOrEqual(5);
    expect(result.data.participants).toContain('Alice');
    expect(result.data.participants).toContain('Bob');
  });

  it('detects system messages (no author)', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'whatsapp-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'whatsapp-chat.txt');
    const result = await parseWhatsApp(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const systemMsgs = result.data.messages.filter((m) => m.type === 'system');
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles multi-line messages', async () => {
    const content = `1/15/24, 2:35 PM - Bob: Sounds great! Let me check the weather\nfirst and I'll get back to you.`;
    const file = makeFile(content, 'multiline.txt');
    const result = await parseWhatsApp(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages[0].content).toContain('first');
  });

  it('strips invisible Unicode marks', async () => {
    const content = `\u200E1/15/24, 2:30 PM - Alice: Hello`;
    const file = makeFile(content, 'unicode.txt');
    const result = await parseWhatsApp(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for empty file', async () => {
    const file = makeFile('', 'empty.txt');
    const result = await parseWhatsApp(file);
    expect(result.success).toBe(false);
  });

  it('computes time range correctly', async () => {
    const content = readFileSync(
      join(__dirname, 'golden-samples', 'whatsapp-sample.txt'),
      'utf-8',
    );
    const file = makeFile(content, 'whatsapp-chat.txt');
    const result = await parseWhatsApp(file);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.timeRange.earliest).not.toBeNull();
    expect(result.data.timeRange.latest).not.toBeNull();
  });
});
