import type {
  ChatParseOutcome,
  ChatParseOptions,
  IMChatMessage,
  ParsedChatHistory,
} from './chat-parser-types';
import { computeTimeRange } from './parser-utils';

const QQ_MSG_HEADER = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})\s*(AM|PM|上午|下午)?\s+(.+?)\((\d+)\)\s*$/;
const QQ_SECTION_SEPARATOR = /^={5,}\s*$/;

function parseTimePeriod(date: string, time: string, period?: string): Date | null {
  try {
    let h: number;
    const [hStr, m, s] = time.split(':').map(Number);
    h = hStr;
    if (period) {
      const lp = period.toLowerCase();
      if ((lp === 'pm' || lp === '下午') && h !== 12) h += 12;
      if ((lp === 'am' || lp === '上午') && h === 12) h = 0;
    }
    const d = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ───── TXT Parser ─────

// SU-ITER-090c · P2-17 — QQ chat exports are UTF-8 on modern clients but the
// older Windows client still writes GBK with no BOM.  We try strict UTF-8
// first (`fatal: true` makes TextDecoder throw on invalid byte sequences),
// and fall back to GBK on failure.  Node.js ships with the ICU small-icu
// build which includes GBK; browsers (Chromium/WebKit/Firefox) all ship GBK
// in the encoding standard.  If GBK is somehow unavailable we log and fall
// back to lenient UTF-8 so parsing still completes (U+FFFD replacement
// chars but no crash).
function decodeQQBufferWithFallback(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch (e) {
      console.warn(
        '[qq-parser] GBK decoder unavailable; falling back to lenient UTF-8.',
        e,
      );
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}

function detectAndDecodeQQTxt(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  if (view.length >= 2 && view[0] === 0xFF && view[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
    // SU-ITER-090c · P2-17 NIT cleanup (mini-Gate N-5) — BOM is part of
    // UTF-8 and a BOM-carrying file's payload is always valid UTF-8, so
    // run the strict decoder here too.  If the post-BOM bytes are
    // actually GBK (impossible per spec, but adversarial input could
    // prepend a fake BOM), `fatal: true` surfaces the mismatch to the
    // catch below instead of silently emitting U+FFFD.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return decodeQQBufferWithFallback(buffer);
    }
  }
  return decodeQQBufferWithFallback(buffer);
}

function parseQQTxt(content: string): ParsedChatHistory {
  const lines = content.split(/\r?\n/);
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;
  let groupName: string | undefined;
  let headerPassed = false;

  for (let i = 0; i < lines.length; i++) {
    if (!headerPassed) {
      if (QQ_SECTION_SEPARATOR.test(lines[i] ?? '')) {
        headerPassed = true;
        if (i > 0) {
          const headerLine = lines[i - 1]?.trim();
          if (headerLine && !headerLine.startsWith('消息') && !headerLine.startsWith('Message')) {
            groupName = headerLine;
          }
        }
      }
      continue;
    }

    const match = lines[i]?.match(QQ_MSG_HEADER);
    if (!match) continue;

    const [, dateStr, timeStr, period, sender] = match;
    const timestamp = parseTimePeriod(dateStr, timeStr, period);

    const contentLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !QQ_MSG_HEADER.test(lines[j] ?? '') && !QQ_SECTION_SEPARATOR.test(lines[j] ?? '')) {
      contentLines.push(lines[j] ?? '');
      j++;
    }

    const msgContent = contentLines.join('\n').trim();
    if (!msgContent) {
      skipped++;
      i = j - 1;
      continue;
    }

    participantSet.add(sender);

    const isSystem = sender === '系统消息' || sender === 'System';
    messages.push({
      timestamp,
      sender,
      content: msgContent,
      type: isSystem ? 'system' : detectQQMediaType(msgContent),
    });

    i = j - 1;
  }

  return {
    platform: 'qq',
    format: 'txt',
    messages,
    participants: Array.from(participantSet),
    timeRange: computeTimeRange(messages),
    metadata: {
      groupName,
      totalParsed: messages.length,
      totalSkipped: skipped,
      warnings,
    },
  };
}

function detectQQMediaType(content: string): IMChatMessage['type'] {
  const trimmed = content.trim();
  if (trimmed === '[图片]' || trimmed === '[Image]') return 'image';
  if (trimmed === '[语音]' || trimmed === '[Voice]') return 'voice';
  if (trimmed === '[视频]' || trimmed === '[Video]') return 'video';
  if (trimmed === '[文件]' || trimmed === '[File]') return 'file';
  return 'text';
}

// ───── MHT Parser ─────

function extractHTMLFromMHT(mhtContent: string): string | null {
  const boundaryMatch = mhtContent.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
    const htmlStart = mhtContent.indexOf('<html');
    if (htmlStart >= 0) return mhtContent.slice(htmlStart);
    return null;
  }

  const boundary = boundaryMatch[1];
  const parts = mhtContent.split(`--${boundary}`);

  for (const part of parts) {
    if (/Content-Type:\s*text\/html/i.test(part)) {
      const bodyStart = part.indexOf('\r\n\r\n');
      if (bodyStart >= 0) return part.slice(bodyStart + 4);
      const bodyStart2 = part.indexOf('\n\n');
      if (bodyStart2 >= 0) return part.slice(bodyStart2 + 2);
    }
  }

  return null;
}

function parseQQMhtHtml(html: string): ParsedChatHistory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const messages: IMChatMessage[] = [];
  const warnings: string[] = [];
  const participantSet = new Set<string>();
  let skipped = 0;

  const rows = doc.querySelectorAll('tr, .msgItem, [class*="msg"]');

  rows.forEach((row) => {
    const cells = row.querySelectorAll('td, .sender, .content');
    if (cells.length < 2) {
      const textContent = row.textContent?.trim();
      if (textContent) {
        const headerMatch = textContent.match(QQ_MSG_HEADER);
        if (headerMatch) {
          return;
        }
      }
      skipped++;
      return;
    }

    const headerCell = cells[0]?.textContent?.trim() ?? '';
    const contentCell = cells[1]?.textContent?.trim() ?? '';

    const headerMatch = headerCell.match(
      /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})\s*(AM|PM|上午|下午)?\s+(.+)/,
    );

    if (headerMatch) {
      const [, dateStr, timeStr, period, sender] = headerMatch;
      const timestamp = parseTimePeriod(dateStr, timeStr, period);
      participantSet.add(sender);

      messages.push({
        timestamp,
        sender,
        content: contentCell || '[content not parsed]',
        type: detectQQMediaType(contentCell),
      });
    } else if (headerCell) {
      participantSet.add(headerCell);
      messages.push({
        timestamp: null,
        sender: headerCell,
        content: contentCell || '[content not parsed]',
        type: detectQQMediaType(contentCell),
      });
    } else {
      skipped++;
    }
  });

  return {
    platform: 'qq',
    format: 'mht',
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

export async function parseQQ(
  file: File,
  _options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'mht' || ext === 'mhtml') {
      const text = await file.text();
      const html = extractHTMLFromMHT(text);
      if (!html) {
        return {
          success: false,
          error: { type: 'format', message: 'Could not extract HTML content from this MHT file.' },
        };
      }
      const result = parseQQMhtHtml(html);
      if (result.messages.length === 0) {
        return {
          success: false,
          error: { type: 'empty', message: 'No messages could be parsed from this QQ MHT file.' },
        };
      }
      return { success: true, data: result };
    }

    const buffer = await file.arrayBuffer();
    const content = detectAndDecodeQQTxt(buffer);
    const result = parseQQTxt(content);

    if (result.messages.length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'No messages could be parsed from this QQ TXT file.' },
      };
    }
    return { success: true, data: result };
  } catch (e) {
    return {
      success: false,
      error: { type: 'parse', message: `QQ parse error: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
