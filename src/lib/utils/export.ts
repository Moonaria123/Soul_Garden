import type { SoulDocs, SoulDocKeyV1, TextMaterial } from '@/types';
import { SOUL_DOC_KEYS_V1, SOUL_DOC_LABELS } from '@/types';
import JSZip from 'jszip';

// ============================================================
// Export Utilities — FR-301
// ZIP export with 5 .md files, or single doc export
// ============================================================

/**
 * Export all soul docs as a ZIP file.
 */
export async function exportEntityZip(
  entityName: string,
  soulDocs: SoulDocs,
  textMaterials?: TextMaterial[],
  chatMaterials?: TextMaterial[],
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(entityName);

  if (!folder) throw new Error('Failed to create ZIP folder');

  for (const key of SOUL_DOC_KEYS_V1) {
    if (soulDocs[key]) {
      const label = SOUL_DOC_LABELS[key];
      folder.file(`${key}.md`, `# ${label}\n\n${soulDocs[key]}`);
    }
  }

  const manifestLines: string[] = [`# ${entityName} — Source Material Manifest`, ''];

  if (chatMaterials && chatMaterials.length > 0) {
    manifestLines.push('## Chat Records');
    for (const m of chatMaterials) {
      manifestLines.push(`- **${m.filename}** — ${m.charCount} chars, imported ${m.importedAt}`);
    }
    manifestLines.push('');
  }

  if (textMaterials && textMaterials.length > 0) {
    manifestLines.push('## Text Materials');
    for (const m of textMaterials) {
      manifestLines.push(`- **${m.filename}** — ${m.charCount} chars (${m.detectedLanguageLabel}), imported ${m.importedAt}`);
    }
    manifestLines.push('');
  }

  if (manifestLines.length > 2) {
    folder.file('MATERIALS_MANIFEST.md', manifestLines.join('\n'));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${entityName}_soul_docs.zip`);
}

/**
 * Export a single soul doc as a .md file.
 */
export function exportSingleDoc(
  entityName: string,
  key: SoulDocKeyV1,
  content: string
): void {
  const label = SOUL_DOC_LABELS[key];
  const blob = new Blob([`# ${label}\n\n${content}`], { type: 'text/markdown' });
  downloadBlob(blob, `${entityName}_${key}.md`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
