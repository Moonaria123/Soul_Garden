'use client';

import { useState, useCallback, useRef } from 'react';
import type { TextMaterial } from '@/types';
import { IM_MATERIAL_CONSTANTS } from '@/types';
import type { ParsedChatHistory, ChatParseOptions } from '@/lib/parsers/chat-parser-types';
import { detectAndParse } from '@/lib/parsers/chat-parser-registry';
import { chatToMaterial } from '@/lib/parsers/chat-to-material';
import { Upload, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { ChatImportPreview } from './chat-import-preview';
import { ChatMaterialBadge } from './chat-material-badge';

interface ChatRecordUploadProps {
  materials: TextMaterial[];
  onMaterialsChange: (materials: TextMaterial[]) => void;
  maxFiles?: number;
  className?: string;
}

export function ChatRecordUpload({
  materials,
  onMaterialsChange,
  maxFiles = IM_MATERIAL_CONSTANTS.MAX_FILES_PER_ENTITY,
  className,
}: ChatRecordUploadProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedChatHistory | null>(null);
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > IM_MATERIAL_CONSTANTS.MAX_FILE_SIZE_BYTES) {
      return t('chatImport.error.tooLarge');
    }
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!(IM_MATERIAL_CONSTANTS.ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      return t('chatImport.error.unsupportedFormat');
    }
    return null;
  }, [t]);

  const processFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsProcessing(true);
    setParsedResult(null);

    const result = await detectAndParse(file);

    if (!result.success) {
      toast.error(t('chatImport.error.parseFailed'), {
        description: result.error.message,
      });
      setIsProcessing(false);
      return;
    }

    setParsedResult(result.data);
    setSelectedSpeakers(result.data.participants);
    setIsProcessing(false);
  }, [validateFile, t]);

  const handleConfirmImport = useCallback(async () => {
    if (!parsedResult) return;

    const remaining = maxFiles - materials.length;
    if (remaining <= 0) {
      toast.error(t('chatImport.error.maxReached'));
      return;
    }

    const options: ChatParseOptions = {
      targetSpeakers: selectedSpeakers,
      excludeSystemMessages: false,
    };

    const material = await chatToMaterial(parsedResult, options);
    onMaterialsChange([...materials, material]);
    toast.success(t('chatImport.imported', { count: String(parsedResult.metadata.totalParsed) }));
    setParsedResult(null);
    setSelectedSpeakers([]);
  }, [parsedResult, materials, maxFiles, onMaterialsChange, selectedSpeakers, t]);

  const handleCancelPreview = useCallback(() => {
    setParsedResult(null);
    setSelectedSpeakers([]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
      e.target.value = '';
    }
  }, [processFile]);

  const removeMaterial = useCallback((id: string) => {
    onMaterialsChange(materials.filter((m) => m.id !== id));
  }, [materials, onMaterialsChange]);

  const acceptStr = IM_MATERIAL_CONSTANTS.ACCEPTED_EXTENSIONS.join(',');

  return (
    <div className={className}>
      {/* Platform badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['WeChat', 'QQ', 'Feishu', 'DingTalk', 'WhatsApp'] as const).map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground"
          >
            {name}
          </span>
        ))}
      </div>

      {/* Drop zone */}
      {!parsedResult && (
        <div
          className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
            isDragOver
              ? 'border-primary bg-[hsl(var(--su-primary-highlight))]/30'
              : 'border-border hover:border-primary/40 hover:bg-[hsl(var(--su-primary-highlight))]/10'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptStr}
            className="hidden"
            onChange={handleFileSelect}
          />

          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--su-primary-highlight))] flex items-center justify-center">
              <Upload className={`h-5 w-5 text-primary ${isProcessing ? 'animate-pulse' : ''}`} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground font-[family-name:var(--font-display)]">
                {t('chatImport.dropzone.title')}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {t('chatImport.dropzone.hint')}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              {t('chatImport.dropzone.formats')}
            </p>
          </div>
        </div>
      )}

      {/* Parse preview */}
      {parsedResult && (
        <ChatImportPreview
          parsed={parsedResult}
          selectedSpeakers={selectedSpeakers}
          onSelectedSpeakersChange={setSelectedSpeakers}
          onConfirm={handleConfirmImport}
          onCancel={handleCancelPreview}
        />
      )}

      {/* Imported material list */}
      {materials.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {t('chatImport.count', { count: String(materials.length), max: String(maxFiles) })}
          </p>
          {materials.map((m) => (
            <ChatMaterialBadge
              key={m.id}
              material={m}
              onRemove={() => removeMaterial(m.id)}
            />
          ))}
        </div>
      )}

      {/* Privacy notice */}
      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground/80">
        <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/60" />
        <p>{t('chatImport.privacyNote')}</p>
      </div>
    </div>
  );
}
