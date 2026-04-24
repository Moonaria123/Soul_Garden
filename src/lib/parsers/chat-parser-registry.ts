import type { ChatParseOutcome, ChatParseOptions } from './chat-parser-types';
import { detectIMFormat } from './chat-format-detector';
import { parseWechat } from './wechat-parser';
import { parseQQ } from './qq-parser';
import { parseFeishu } from './feishu-parser';
import { parseDingtalk } from './dingtalk-parser';
import { parseWhatsApp } from './whatsapp-parser';
import type { IMPlatform } from './chat-parser-types';

type PlatformParser = (file: File, options?: ChatParseOptions) => Promise<ChatParseOutcome>;

const parsers: Record<Exclude<IMPlatform, 'unknown'>, PlatformParser> = {
  wechat: parseWechat,
  qq: parseQQ,
  feishu: parseFeishu,
  dingtalk: parseDingtalk,
  whatsapp: parseWhatsApp,
};

export async function detectAndParse(
  file: File,
  options?: ChatParseOptions,
): Promise<ChatParseOutcome> {
  const detection = await detectIMFormat(file);

  if (!detection || detection.platform === 'unknown') {
    return {
      success: false,
      error: {
        type: 'unsupported',
        message: 'Unable to detect the chat platform from this file. Please check the file format.',
      },
    };
  }

  const parser = parsers[detection.platform];
  return parser(file, options);
}

export { detectIMFormat };
