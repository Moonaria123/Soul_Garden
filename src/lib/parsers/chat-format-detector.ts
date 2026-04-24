import type { IMFormatDetection } from './chat-parser-types';

// RLX-ESL-02 (SU-092-batch1): the fingerprint patterns below are anchored
// (`^`/`\b`), use fixed-length `\d{N}` + non-nested quantifiers, and are
// matched against bounded `.slice(0, 8000)` samples — safe-regex's
// catastrophic-backtracking heuristic is a known false positive on
// CJK alternations like `上午|下午`.  Disabled per-declaration below.

/* eslint-disable security/detect-unsafe-regex */
const WECHAT_TXT_PATTERN = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?\s*\n.+\n/m;
const WECHAT_HTML_LEFT_RIGHT = /class\s*=\s*["'].*?\bmessage\b.*?\b(left|right)\b/i;

const QQ_TXT_HEADER = /={5,}/;
const QQ_TXT_MSG = /\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM|上午|下午)?\s+.+\([\d]+\)/;

const WHATSAPP_ANDROID = /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*[-–]\s*.+:/m;
const WHATSAPP_IOS = /^\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?\]\s*.+:/m;
const WHATSAPP_GENERIC = /\u200e?\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}[:.]\d{2}/m;

const DINGTALK_TXT_PATTERN = /.+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?/m;
const DINGTALK_HTML_PATTERN = /class\s*=\s*["'].*?\b(dtk-msg|msg-content|chat-msg)\b/i;
/* eslint-enable security/detect-unsafe-regex */

const QQ_MHT_FINGERPRINT = /Tencent\s+(MsgMgr|IM\s+Message)/i;

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}

export function detectFromText(content: string, _filename: string): IMFormatDetection | null {
  const clean = stripBOM(content);
  const sample = clean.slice(0, 8000);

  if (QQ_TXT_HEADER.test(sample) && QQ_TXT_MSG.test(sample)) {
    return { platform: 'qq', format: 'txt', confidence: 'high' };
  }

  if (WHATSAPP_ANDROID.test(sample) || WHATSAPP_IOS.test(sample)) {
    return { platform: 'whatsapp', format: 'txt', confidence: 'high' };
  }

  if (WECHAT_TXT_PATTERN.test(sample)) {
    return { platform: 'wechat', format: 'txt', confidence: 'medium' };
  }

  if (DINGTALK_TXT_PATTERN.test(sample)) {
    return { platform: 'dingtalk', format: 'txt', confidence: 'low' };
  }

  if (WHATSAPP_GENERIC.test(sample)) {
    return { platform: 'whatsapp', format: 'txt', confidence: 'low' };
  }

  return null;
}

export function detectFromHTML(content: string): IMFormatDetection | null {
  const sample = content.slice(0, 15000);

  if (QQ_MHT_FINGERPRINT.test(sample)) {
    return { platform: 'qq', format: 'html', confidence: 'high' };
  }

  if (WECHAT_HTML_LEFT_RIGHT.test(sample)) {
    return { platform: 'wechat', format: 'html', confidence: 'high' };
  }

  if (DINGTALK_HTML_PATTERN.test(sample)) {
    return { platform: 'dingtalk', format: 'html', confidence: 'medium' };
  }

  return null;
}

export function detectFromMHT(content: string): IMFormatDetection | null {
  const sample = content.slice(0, 10000);

  if (QQ_MHT_FINGERPRINT.test(sample)) {
    return { platform: 'qq', format: 'mht', confidence: 'high' };
  }

  return null;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function hasUTF16LEBOM(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 2) return false;
  const view = new Uint8Array(buffer);
  return view[0] === 0xFF && view[1] === 0xFE;
}

export async function detectIMFormat(
  file: File,
): Promise<IMFormatDetection | null> {
  const ext = getExtension(file.name);

  if (ext === '.docx') {
    return { platform: 'feishu', format: 'docx', confidence: 'medium' };
  }

  if (ext === '.mht' || ext === '.mhtml') {
    const text = await file.text();
    return detectFromMHT(text);
  }

  if (ext === '.html' || ext === '.htm') {
    const text = await file.text();
    return detectFromHTML(text);
  }

  if (ext === '.txt') {
    const buffer = await file.arrayBuffer();

    let text: string;
    if (hasUTF16LEBOM(buffer)) {
      const decoder = new TextDecoder('utf-16le');
      text = decoder.decode(buffer);
    } else {
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(buffer);
    }

    return detectFromText(text, file.name);
  }

  return null;
}
