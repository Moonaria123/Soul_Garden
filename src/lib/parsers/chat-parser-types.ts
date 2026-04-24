export type IMPlatform = 'wechat' | 'qq' | 'feishu' | 'dingtalk' | 'whatsapp' | 'unknown';
export type IMFormat = 'html' | 'txt' | 'docx' | 'mht';

export interface IMChatMessage {
  timestamp: Date | null;
  sender: string;
  content: string;
  type: 'text' | 'image' | 'voice' | 'video' | 'file' | 'system' | 'other';
}

export interface ParsedChatHistory {
  platform: IMPlatform;
  format: IMFormat;
  messages: IMChatMessage[];
  participants: string[];
  timeRange: { earliest: Date | null; latest: Date | null };
  metadata: {
    groupName?: string;
    totalParsed: number;
    totalSkipped: number;
    warnings: string[];
  };
}

export interface ChatParseOptions {
  targetSpeakers?: string[];
  excludeSystemMessages?: boolean;
  maxMessages?: number;
}

export interface ChatParseResult {
  success: true;
  data: ParsedChatHistory;
}

export interface ChatParseError {
  success: false;
  error: {
    type: 'format' | 'encoding' | 'empty' | 'size' | 'unsupported' | 'parse';
    message: string;
  };
}

export type ChatParseOutcome = ChatParseResult | ChatParseError;

export interface IMFormatDetection {
  platform: IMPlatform;
  format: IMFormat;
  confidence: 'high' | 'medium' | 'low';
}

export type ChatParser = (
  file: File,
  rawContent: string | ArrayBuffer,
  options?: ChatParseOptions,
) => Promise<ChatParseOutcome>;
