import type {
  ChatParseOutcome,
  ChatParseOptions,
  IMChatMessage,
  ParsedChatHistory,
} from './chat-parser-types';
import { computeTimeRange } from './parser-utils';

function stripInvisibleMarks(text: string): string {
  return text.replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, '');
}

export async function parseWhatsApp(
  file: File,
  _options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  try {
    const { parseString } = await import('whatsapp-chat-parser');
    const rawText = await file.text();
    const cleaned = stripInvisibleMarks(rawText);

    const parsed = parseString(cleaned, { parseAttachments: true });

    if (!parsed || parsed.length === 0) {
      return {
        success: false,
        error: { type: 'empty', message: 'No messages could be parsed from this WhatsApp file.' },
      };
    }

    const participantSet = new Set<string>();
    const messages: IMChatMessage[] = [];

    for (const msg of parsed) {
      const sender = msg.author ?? '';
      if (msg.author) participantSet.add(msg.author);

      let type: IMChatMessage['type'] = 'text';
      if (!msg.author) {
        type = 'system';
      } else if (msg.attachment) {
        const ext = msg.attachment.fileName.split('.').pop()?.toLowerCase() ?? '';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';
        else if (['mp4', 'mov', 'avi', '3gp'].includes(ext)) type = 'video';
        else if (['opus', 'ogg', 'mp3', 'wav', 'm4a'].includes(ext)) type = 'voice';
        else type = 'file';
      } else if (
        msg.message.includes('<Media omitted>') ||
        msg.message.includes('image omitted') ||
        msg.message.includes('video omitted') ||
        msg.message.includes('audio omitted') ||
        msg.message.includes('sticker omitted') ||
        msg.message.includes('GIF omitted')
      ) {
        type = 'other';
      }

      messages.push({
        timestamp: msg.date && !isNaN(msg.date.getTime()) ? msg.date : null,
        sender: sender || 'System',
        content: msg.message,
        type,
      });
    }

    const data: ParsedChatHistory = {
      platform: 'whatsapp',
      format: 'txt',
      messages,
      participants: Array.from(participantSet),
      timeRange: computeTimeRange(messages),
      metadata: {
        totalParsed: messages.length,
        totalSkipped: 0,
        warnings: [],
      },
    };

    return { success: true, data };
  } catch (e) {
    return {
      success: false,
      error: {
        type: 'parse',
        message: `WhatsApp parse error: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
}
