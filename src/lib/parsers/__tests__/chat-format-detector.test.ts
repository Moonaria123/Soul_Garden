import { describe, it, expect } from 'vitest';
import { detectFromText, detectFromHTML, detectFromMHT } from '../chat-format-detector';

describe('detectFromText', () => {
  it('detects WeChat TXT format', () => {
    const content = `2024-01-15 14:30:22\n张三\n今天天气真好\n\n2024-01-15 14:31:05\n李四\n好呀`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('wechat');
    expect(result!.format).toBe('txt');
  });

  it('detects QQ TXT format', () => {
    const content = `消息记录\n=====\n2024-01-15 10:30:00 上午 好友A(12345678)\n你好呀`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('qq');
    expect(result!.format).toBe('txt');
  });

  it('detects WhatsApp Android format', () => {
    const content = `1/15/24, 2:30 PM - Alice: Hey, how are you?`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('whatsapp');
    expect(result!.format).toBe('txt');
  });

  it('detects WhatsApp iOS format', () => {
    const content = `[1/15/24, 2:30:00 PM] Alice: Hey, how are you?`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('whatsapp');
    expect(result!.format).toBe('txt');
  });

  it('detects DingTalk TXT format', () => {
    const content = `王五 2024-01-15 09:00:00\n大家早上好`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('dingtalk');
    expect(result!.format).toBe('txt');
  });

  it('returns null for unrecognized format', () => {
    const content = `This is just some random text with no chat format.`;
    const result = detectFromText(content, 'random.txt');
    expect(result).toBeNull();
  });

  it('handles BOM-prefixed content', () => {
    const content = `\uFEFF1/15/24, 2:30 PM - Alice: Hey`;
    const result = detectFromText(content, 'chat.txt');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('whatsapp');
  });
});

describe('detectFromHTML', () => {
  it('detects WeChat HTML from class names', () => {
    const html = `<div class="message left"><span class="nickname">张三</span></div>`;
    const result = detectFromHTML(html);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('wechat');
  });

  it('detects DingTalk HTML', () => {
    const html = `<div class="dtk-msg"><span class="sender">王五</span></div>`;
    const result = detectFromHTML(html);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('dingtalk');
  });

  it('returns null for generic HTML', () => {
    const html = `<html><body><p>Hello</p></body></html>`;
    const result = detectFromHTML(html);
    expect(result).toBeNull();
  });
});

describe('detectFromMHT', () => {
  it('detects QQ MHT from Tencent MsgMgr fingerprint', () => {
    const mht = `Content-Type: multipart/related;\nTencent MsgMgr Export\n<html>`;
    const result = detectFromMHT(mht);
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('qq');
    expect(result!.format).toBe('mht');
  });

  it('returns null for non-QQ MHT', () => {
    const mht = `Content-Type: multipart/related;\nsome other content`;
    const result = detectFromMHT(mht);
    expect(result).toBeNull();
  });
});
