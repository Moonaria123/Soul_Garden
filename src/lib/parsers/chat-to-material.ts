import { v4 as uuid } from 'uuid';
import type { TextMaterial } from '@/types';
import type { ParsedChatHistory, ChatParseOptions, IMPlatform } from './chat-parser-types';
import { detectLanguage } from './text-parser';

const PLATFORM_LABELS: Record<IMPlatform, string> = {
  wechat: 'WeChat',
  qq: 'QQ',
  feishu: 'Feishu',
  dingtalk: 'DingTalk',
  whatsapp: 'WhatsApp',
  unknown: 'Chat',
};

function formatTimestamp(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

export function formatChatAsText(
  parsed: ParsedChatHistory,
  options?: ChatParseOptions,
): string {
  let messages = parsed.messages;

  if (options?.excludeSystemMessages) {
    messages = messages.filter((m) => m.type !== 'system');
  }

  if (options?.targetSpeakers && options.targetSpeakers.length > 0) {
    const set = new Set(options.targetSpeakers.map((s) => s.toLowerCase()));
    messages = messages.filter(
      (m) => m.type === 'system' || set.has(m.sender.toLowerCase()),
    );
  }

  if (options?.maxMessages && messages.length > options.maxMessages) {
    messages = messages.slice(0, options.maxMessages);
  }

  const lines: string[] = [];
  for (const msg of messages) {
    const ts = formatTimestamp(msg.timestamp);
    const prefix = ts ? `[${ts}] ` : '';
    lines.push(`${prefix}${msg.sender}: ${msg.content}`);
  }

  return lines.join('\n');
}

function buildFilename(parsed: ParsedChatHistory, speakers: string[]): string {
  const platform = PLATFORM_LABELS[parsed.platform];
  const speakerStr = speakers.length > 0
    ? speakers.slice(0, 3).join(', ')
    : parsed.participants.slice(0, 3).join(', ');

  const dateRange = parsed.timeRange.earliest && parsed.timeRange.latest
    ? ` (${formatTimestamp(parsed.timeRange.earliest).split(' ')[0]}~${formatTimestamp(parsed.timeRange.latest).split(' ')[0]})`
    : '';

  return `${platform} Chat with ${speakerStr}${dateRange}`;
}

export async function chatToMaterial(
  parsed: ParsedChatHistory,
  options?: ChatParseOptions,
): Promise<TextMaterial> {
  const text = formatChatAsText(parsed, options);
  const langCode = await detectLanguage(text);

  const LANGUAGE_LABELS: Record<string, string> = {
    cmn: '中文',
    eng: 'English',
    jpn: '日本語',
    kor: '한국어',
    und: 'Unknown',
  };

  return {
    id: uuid(),
    filename: buildFilename(parsed, options?.targetSpeakers ?? []),
    content: text.slice(0, 50_000),
    detectedLanguage: langCode,
    detectedLanguageLabel: LANGUAGE_LABELS[langCode] || langCode,
    fileSize: new Blob([text]).size,
    charCount: text.length,
    importedAt: new Date().toISOString(),
  };
}
