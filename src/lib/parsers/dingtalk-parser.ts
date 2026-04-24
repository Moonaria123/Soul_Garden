import type {
  ChatParseOutcome,
  ChatParseOptions,
  IMChatMessage,
  ParsedChatHistory,
} from './chat-parser-types';
import { computeTimeRange } from './parser-utils';

// RLX-ESL-02 (SU-092-batch1): anchored (^…$) with non-greedy .+? and fixed-length
// \d{N} — safe-regex false positive.
// eslint-disable-next-line security/detect-unsafe-regex
const DINGTALK_TXT_HEADER = /^(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s*$/;

function detectMediaType(content: string): IMChatMessage['type'] {
  const trimmed = content.trim();
  if (trimmed === '[图片]' || trimmed === '[Image]') return 'image';
  if (trimmed === '[语音]' || trimmed === '[Voice]') return 'voice';
  if (trimmed === '[视频]' || trimmed === '[Video]') return 'video';
  if (trimmed === '[文件]' || trimmed === '[File]') return 'file';
  return 'text';
}

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}

// ───── TXT Parser ─────

function parseDingtalkTxt(content: string): ParsedChatHistory {
  const lines = stripBOM(content).split(/\r?\n/);
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  let i = 0;
  while (i < lines.length) {
    const match = lines[i]?.match(DINGTALK_TXT_HEADER);
    if (!match) {
      i++;
      continue;
    }

    const [, sender, dateStr, timeStr] = match;
    let timestamp: Date | null = null;
    try {
      const ts = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
      timestamp = new Date(`${dateStr}T${ts}`);
      if (isNaN(timestamp.getTime())) timestamp = null;
    } catch {
      timestamp = null;
    }

    const contentLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !DINGTALK_TXT_HEADER.test(lines[j] ?? '')) {
      contentLines.push(lines[j] ?? '');
      j++;
    }

    const msgContent = contentLines.join('\n').trim();
    if (!msgContent) {
      skipped++;
      i = j;
      continue;
    }

    participantSet.add(sender);

    messages.push({
      timestamp,
      sender,
      content: msgContent,
      type: detectMediaType(msgContent),
    });

    i = j;
  }

  return {
    platform: 'dingtalk',
    format: 'txt',
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

// ───── HTML Parser ─────

function parseDingtalkHtml(content: string): ParsedChatHistory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  const selectors = [
    '.dtk-msg', '.msg-item', '.chat-msg',
    '[class*="message"]', '[class*="msg-item"]',
  ];

  let msgEls: NodeListOf<Element> | null = null;
  for (const sel of selectors) {
    const found = doc.querySelectorAll(sel);
    if (found.length > 0) {
      msgEls = found;
      break;
    }
  }

  if (!msgEls || msgEls.length === 0) {
    const allDivs = doc.querySelectorAll('div');
    const candidateDivs: Element[] = [];
    allDivs.forEach((div) => {
      const text = div.textContent?.trim() ?? '';
      if (text.length > 0 && text.length < 5000) {
        candidateDivs.push(div);
      }
    });

    if (candidateDivs.length === 0) {
      warnings.push('No message containers found in DingTalk HTML.');
      return {
        platform: 'dingtalk',
        format: 'html',
        messages: [],
        participants: [],
        timeRange: { earliest: null, latest: null },
        metadata: { totalParsed: 0, totalSkipped: 0, warnings },
      };
    }
  }

  if (msgEls) {
    msgEls.forEach((el) => {
      const senderEl = el.querySelector(
        '.sender, .nickname, .name, [class*="sender"], [class*="nickname"], [class*="name"]',
      );
      const contentEl = el.querySelector(
        '.content, .bubble, .msg-content, [class*="content"], [class*="bubble"]',
      );
      const timeEl = el.querySelector(
        '.time, .timestamp, [class*="time"]',
      );

      const sender = senderEl?.textContent?.trim() ?? '';
      const msgContent = contentEl?.textContent?.trim() ?? '';
      const timeText = timeEl?.textContent?.trim();

      if (!sender && !msgContent) {
        skipped++;
        return;
      }

      let timestamp: Date | null = null;
      if (timeText) {
        try {
          timestamp = new Date(timeText);
          if (isNaN(timestamp.getTime())) timestamp = null;
        } catch {
          timestamp = null;
        }
      }

      if (sender) participantSet.add(sender);

      messages.push({
        timestamp,
        sender: sender || 'Unknown',
        content: msgContent || '[content not parsed]',
        type: detectMediaType(msgContent),
      });
    });
  }

  return {
    platform: 'dingtalk',
    format: 'html',
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

// ───── Entry ─────

export async function parseDingtalk(
  file: File,
  _options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'html' || ext === 'htm') {
      const text = await file.text();
      const result = parseDingtalkHtml(text);
      if (result.messages.length === 0) {
        return {
          success: false,
          error: { type: 'empty', message: 'No messages could be parsed from this DingTalk HTML file.' },
        };
      }
      return { success: true, data: result };
    }

    const text = await file.text();
    const result = parseDingtalkTxt(text);
    if (result.messages.length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'No messages could be parsed from this DingTalk TXT file.' },
      };
    }
    return { success: true, data: result };
  } catch (e) {
    return {
      success: false,
      error: { type: 'parse', message: `DingTalk parse error: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
