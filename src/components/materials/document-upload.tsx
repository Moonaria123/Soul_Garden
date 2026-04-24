'use client';

import { useState, useCallback, useRef } from 'react';
import type { TextMaterial } from '@/types';
import { TEXT_MATERIAL_CONSTANTS } from '@/types';
import { parseTextFile, isParseError, formatFileSize, formatCharCount } from '@/lib/parsers/text-parser';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Upload, X, Globe, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

interface DocumentUploadProps {
  materials: TextMaterial[];
  onMaterialsChange: (materials: TextMaterial[]) => void;
  maxFiles?: number;
  className?: string;
}

export function DocumentUpload({
  materials,
  onMaterialsChange,
  maxFiles = TEXT_MATERIAL_CONSTANTS.MAX_FILES_PER_ENTITY,
  className,
}: DocumentUploadProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const remaining = maxFiles - materials.length;
      if (remaining <= 0) {
        toast.error(t('materials.maxReached'));
        return;
      }

      setIsProcessing(true);
      const filesToProcess = Array.from(files).slice(0, remaining);
      const newMaterials: TextMaterial[] = [];

      for (const file of filesToProcess) {
        const result = await parseTextFile(file);
        if (isParseError(result)) {
          toast.error(t('materials.parseError', { filename: file.name }), {
            description: result.message,
          });
          continue;
        }

        const duplicate = materials.find(
          (m) => m.filename === result.material.filename && m.charCount === result.material.charCount
        );
        if (duplicate) {
          toast.info(t('materials.duplicate', { filename: file.name }));
          continue;
        }

        newMaterials.push(result.material);
      }

      if (newMaterials.length > 0) {
        onMaterialsChange([...materials, ...newMaterials]);
        toast.success(
          t('materials.imported', { count: String(newMaterials.length) })
        );
      }

      setIsProcessing(false);
    },
    [materials, maxFiles, onMaterialsChange, t]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
        e.target.value = '';
      }
    },
    [processFiles]
  );

  const removeMaterial = useCallback(
    (id: string) => {
      onMaterialsChange(materials.filter((m) => m.id !== id));
    },
    [materials, onMaterialsChange]
  );

  return (
    <div className={className}>
      {/* Drop zone */}
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
          accept=".md,.txt,text/plain,text/markdown"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[hsl(var(--su-primary-highlight))] flex items-center justify-center">
            <Upload className={`h-5 w-5 text-primary ${isProcessing ? 'animate-pulse' : ''}`} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground font-[family-name:var(--font-display)]">
              {t('materials.dropzone.title')}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('materials.dropzone.hint')}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {t('materials.dropzone.formats')}
          </p>
        </div>
      </div>

      {/* Material list */}
      {materials.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {t('materials.count', { count: String(materials.length), max: String(maxFiles) })}
          </p>
          {materials.map((m) => (
            <Card key={m.id} className="border-border bg-card">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[hsl(var(--su-primary-highlight))] flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{m.filename}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{formatFileSize(m.fileSize)}</span>
                    <span>·</span>
                    <span>{formatCharCount(m.charCount)} {t('materials.chars')}</span>
                    {m.detectedLanguage !== 'und' && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <Globe className="h-3 w-3" />
                          {m.detectedLanguageLabel}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMaterial(m.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Language detection summary */}
      {materials.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from(new Set(materials.map((m) => m.detectedLanguage)))
            .filter((code) => code !== 'und')
            .map((code) => {
              const label = materials.find((m) => m.detectedLanguage === code)?.detectedLanguageLabel;
              return (
                <Badge key={code} variant="secondary" className="text-[10px]">
                  <Globe className="h-2.5 w-2.5 mr-0.5" /> {label}
                </Badge>
              );
            })}
        </div>
      )}

      {/* Info note */}
      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground/80">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
        <p>{t('materials.privacyNote')}</p>
      </div>
    </div>
  );
}
