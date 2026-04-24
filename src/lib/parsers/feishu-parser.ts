import type {
  ChatParseOutcome,
  ChatParseOptions,
  IMChatMessage,
  ParsedChatHistory,
} from './chat-parser-types';
import { computeTimeRange } from './parser-utils';

// RLX-ESL-02 (SU-092-batch1): fixed-length \d{N} with no nested quantifiers —
// safe-regex false positive.
// eslint-disable-next-line security/detect-unsafe-regex
const FEISHU_TS_PATTERN = /\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?/;
const MEDIA_TAGS = ['[图片]', '[Image]', '[视频]', '[Video]', '[文件]', '[File]', '[语音]', '[Voice]'];

function detectMediaType(content: string): IMChatMessage['type'] {
  const trimmed = content.trim();
  if (trimmed === '[图片]' || trimmed === '[Image]') return 'image';
  if (trimmed === '[语音]' || trimmed === '[Voice]') return 'voice';
  if (trimmed === '[视频]' || trimmed === '[Video]') return 'video';
  if (trimmed === '[文件]' || trimmed === '[File]') return 'file';
  for (const tag of MEDIA_TAGS) {
    if (trimmed.startsWith(tag)) return 'other';
  }
  return 'text';
}

function parseTimestamp(text: string): Date | null {
  const match = text.match(FEISHU_TS_PATTERN);
  if (!match) return null;
  try {
    const normalized = match[0].replace(/\//g, '-');
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function parseFeishuHtml(html: string): ParsedChatHistory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  const paragraphs = doc.querySelectorAll('p');

  let currentSender: string | null = null;
  let currentTimestamp: Date | null = null;
  let contentBuffer: string[] = [];

  function flush() {
    if (currentSender && contentBuffer.length > 0) {
      const content = contentBuffer.join('\n').trim();
      if (content) {
        participantSet.add(currentSender);
        messages.push({
          timestamp: currentTimestamp,
          sender: currentSender,
          content,
          type: detectMediaType(content),
        });
      }
    }
    contentBuffer = [];
  }

  paragraphs.forEach((p) => {
    const strong = p.querySelector('strong, b');
    if (strong) {
      const strongText = strong.textContent?.trim() ?? '';
      const tsMatch = strongText.match(FEISHU_TS_PATTERN);
      const fullText = p.textContent?.trim() ?? '';
      const tsMatchFull = fullText.match(FEISHU_TS_PATTERN);

      if (strongText && (tsMatch || tsMatchFull)) {
        flush();
        const senderPart = strongText.replace(FEISHU_TS_PATTERN, '').trim();
        currentSender = senderPart || strongText;
        currentTimestamp = parseTimestamp(fullText);
        const remainingText = fullText
          .replace(strongText, '')
          .replace(FEISHU_TS_PATTERN, '')
          .trim();
        if (remainingText) {
          contentBuffer.push(remainingText);
        }
        return;
      }

      if (strongText && !tsMatch) {
        flush();
        currentSender = strongText;
        currentTimestamp = parseTimestamp(fullText);
        const remaining = fullText.replace(strongText, '').replace(FEISHU_TS_PATTERN, '').trim();
        if (remaining) contentBuffer.push(remaining);
        return;
      }
    }

    const text = p.textContent?.trim() ?? '';
    if (!text) {
      skipped++;
      return;
    }

    if (currentSender) {
      contentBuffer.push(text);
    } else {
      skipped++;
    }
  });

  flush();

  return {
    platform: 'feishu',
    format: 'docx',
    messages,
    participants: Array.from(participantSet),
    timeRange: computeTimeRange(messages),
    metadata: {
      totalParsed: messages.length,
      totalSkipped: skipped,
      warnings,
    },
  };
}

export async function parseFeishu(
  file: File,
  _options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  try {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });

    if (!result.value || result.value.trim().length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'The DOCX file appears to be empty.' },
      };
    }

    const parsed = parseFeishuHtml(result.value);

    if (parsed.messages.length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'No chat messages could be identified in this Feishu document.' },
      };
    }

    return { success: true, data: parsed };
  } catch (e) {
    return {
      success: false,
      error: { type: 'parse', message: `Feishu parse error: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
