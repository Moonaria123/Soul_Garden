import { v4 as uuid } from 'uuid';
import type { TextMaterial } from '@/types';
import { TEXT_MATERIAL_CONSTANTS } from '@/types';

const LANGUAGE_LABELS: Record<string, string> = {
  cmn: '中文',
  eng: 'English',
  jpn: '日本語',
  kor: '한국어',
  fra: 'Français',
  deu: 'Deutsch',
  spa: 'Español',
  por: 'Português',
  rus: 'Русский',
  ara: 'العربية',
  hin: 'हिन्दी',
  tha: 'ไทย',
  vie: 'Tiếng Việt',
  und: 'Unknown',
};

function getLangLabel(code: string): string {
  return LANGUAGE_LABELS[code] || code;
}

export interface ParseResult {
  material: TextMaterial;
}

export interface ParseError {
  type: 'size' | 'format' | 'empty' | 'read';
  message: string;
}

function validateFile(file: File): ParseError | null {
  if (file.size > TEXT_MATERIAL_CONSTANTS.MAX_FILE_SIZE_BYTES) {
    return {
      type: 'size',
      message: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 5MB`,
    };
  }

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const validExt = TEXT_MATERIAL_CONSTANTS.ACCEPTED_EXTENSIONS.includes(
    ext as (typeof TEXT_MATERIAL_CONSTANTS.ACCEPTED_EXTENSIONS)[number]
  );
  const validMime =
    TEXT_MATERIAL_CONSTANTS.ACCEPTED_MIME_TYPES.includes(
      file.type as (typeof TEXT_MATERIAL_CONSTANTS.ACCEPTED_MIME_TYPES)[number]
    ) || file.type === '';

  if (!validExt && !validMime) {
    return {
      type: 'format',
      message: '目前只能读懂 .md 和 .txt 格式的文件',
    };
  }

  return null;
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    const { franc } = await import('franc');
    const sample = text.slice(0, 5000);
    return franc(sample, { minLength: 20 }) || 'und';
  } catch {
    return 'und';
  }
}

export async function parseTextFile(file: File): Promise<ParseResult | ParseError> {
  const validationError = validateFile(file);
  if (validationError) return validationError;

  try {
    const rawText = await file.text();

    if (!rawText.trim()) {
      return { type: 'empty', message: '这个文件好像是空的，换一个试试？' };
    }

    const content = rawText.slice(0, TEXT_MATERIAL_CONSTANTS.MAX_CHARS);
    const langCode = await detectLanguage(content);

    const material: TextMaterial = {
      id: uuid(),
      filename: file.name,
      content,
      detectedLanguage: langCode,
      detectedLanguageLabel: getLangLabel(langCode),
      fileSize: file.size,
      charCount: content.length,
      importedAt: new Date().toISOString(),
    };

    return { material };
  } catch {
    return { type: 'read', message: '这个文件暂时读不了，换一个试试？' };
  }
}

export function isParseError(result: ParseResult | ParseError): result is ParseError {
  return 'type' in result && 'message' in result && !('material' in result);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCharCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}
