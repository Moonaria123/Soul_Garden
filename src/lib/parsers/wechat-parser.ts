import type {
  ChatParseOutcome,
  ChatParseOptions,
  IMChatMessage,
  ParsedChatHistory,
} from './chat-parser-types';
import { computeTimeRange } from './parser-utils';

const MEDIA_PLACEHOLDERS: Record<string, IMChatMessage['type']> = {
  '[图片]': 'image',
  '[照片]': 'image',
  '[Image]': 'image',
  '[Photo]': 'image',
  '[语音]': 'voice',
  '[Voice]': 'voice',
  '[视频]': 'video',
  '[Video]': 'video',
  '[文件]': 'file',
  '[File]': 'file',
  '[动画表情]': 'other',
  '[Sticker]': 'other',
  '[链接]': 'other',
  '[Link]': 'other',
  '[位置]': 'other',
  '[Location]': 'other',
  '[转账]': 'other',
  '[红包]': 'other',
  '[名片]': 'other',
};

function detectMediaType(content: string): IMChatMessage['type'] {
  const trimmed = content.trim();
  for (const [placeholder, type] of Object.entries(MEDIA_PLACEHOLDERS)) {
    if (trimmed === placeholder || trimmed.startsWith(placeholder)) return type;
  }
  return 'text';
}

// ───── TXT Parser ─────

// RLX-ESL-02 (SU-092-batch1): anchored ^…$ with fixed-length \d{N} — safe-regex false positive.
// eslint-disable-next-line security/detect-unsafe-regex
const WECHAT_TS_LINE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

function parseWechatTxt(content: string): ParsedChatHistory {
  const lines = content.split(/\r?\n/);
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  let i = 0;
  while (i < lines.length) {
    const tsMatch = lines[i]?.match(WECHAT_TS_LINE);
    if (!tsMatch) {
      i++;
      continue;
    }

    const dateStr = tsMatch[1];
    const timeStr = tsMatch[2];
    const sender = lines[i + 1]?.trim();

    if (!sender) {
      skipped++;
      i++;
      continue;
    }

    const contentLines: string[] = [];
    let j = i + 2;
    while (j < lines.length && !WECHAT_TS_LINE.test(lines[j] ?? '')) {
      contentLines.push(lines[j] ?? '');
      j++;
    }

    const msgContent = contentLines.join('\n').trim();
    if (!msgContent) {
      skipped++;
      i = j;
      continue;
    }

    let timestamp: Date | null = null;
    try {
      // SU-ITER-090c · P2-16 — WeChat exports write wall-clock time in the
      // user's local zone; every downstream archive we've seen ships from
      // mainland CN which is fixed UTC+8 (no DST).  Appending the `+08:00`
      // offset locks the parsed instant to Asia/Shanghai so users importing
      // from a different timezone (EU/US/etc.) don't see messages drift by
      // N hours.  If we ever ship a locale picker this should read from
      // user settings instead of a hardcoded offset.
      const timeStrFull = timeStr.length === 5 ? timeStr + ':00' : timeStr;
      timestamp = new Date(`${dateStr}T${timeStrFull}+08:00`);
      if (isNaN(timestamp.getTime())) timestamp = null;
    } catch {
      timestamp = null;
    }

    const isSystem = sender === '系统消息' || sender === 'System Message';
    participantSet.add(sender);

    messages.push({
      timestamp,
      sender,
      content: msgContent,
      type: isSystem ? 'system' : detectMediaType(msgContent),
    });

    i = j;
  }

  return {
    platform: 'wechat',
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

// ───── HTML Parser (MemoTrace / WechatExporter) ─────

function parseWechatHtml(content: string): ParsedChatHistory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  const msgDivs = doc.querySelectorAll('.message, [class*="msg-item"], [class*="message"]');

  if (msgDivs.length === 0) {
    warnings.push('No message elements found in HTML. The template may be unsupported.');
  }

  msgDivs.forEach((div) => {
    const nickEl = div.querySelector('.nickname, .sender, [class*="nickname"], [class*="sender"]');
    const bubbleEl = div.querySelector('.bubble, .content, .msg-content, [class*="bubble"], [class*="content"]');
    const timeEl = div.querySelector('.time, .timestamp, [class*="time"]');

    const sender = nickEl?.textContent?.trim() ?? '';
    const msgContent = bubbleEl?.textContent?.trim() ?? '';

    if (!sender && !msgContent) {
      skipped++;
      return;
    }

    let timestamp: Date | null = null;
    const timeText = timeEl?.textContent?.trim();
    if (timeText) {
      try {
        // SU-ITER-090c · P2-16 NIT cleanup (mini-Gate N-4) — mirror the
        // TXT-path UTC+8 pin.  WeChat HTML exports also emit wall-clock
        // strings without a tz marker (`YYYY-MM-DD HH:MM` or similar);
        // parsing them with bare `new Date(timeText)` drifts by ±N h
        // on out-of-region user machines.  Only inject the offset when
        // the input is a naive wall-clock string (no `Z`, no `±HH:MM`
        // already present) so existing ISO strings with a tz are left
        // alone.
        // RLX-ESL-02 (SU-092-batch1): anchored ^…$, fixed-length \d{N} — safe-regex false positive.
        // eslint-disable-next-line security/detect-unsafe-regex
        const looksNaive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(timeText);
        timestamp = new Date(looksNaive ? `${timeText.replace(' ', 'T')}+08:00` : timeText);
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

  return {
    platform: 'wechat',
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

export async function parseWechat(
  file: File,
  _options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'html' || ext === 'htm') {
      const text = await file.text();
      const result = parseWechatHtml(text);
      if (result.messages.length === 0) {
        return {
          success: false,
          error: { type: 'empty', message: 'No messages could be parsed from this WeChat HTML file.' },
        };
      }
      return { success: true, data: result };
    }

    const text = await file.text();
    const result = parseWechatTxt(text);
    if (result.messages.length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'No messages could be parsed from this WeChat TXT file.' },
      };
    }
    return { success: true, data: result };
  } catch (e) {
    return {
      success: false,
      error: { type: 'parse', message: `WeChat parse error: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
