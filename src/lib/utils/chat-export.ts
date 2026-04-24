import type { ChatMessage } from '@/types';

export function formatChatAsMarkdown(
  entityName: string,
  messages: ChatMessage[],
): string {
  const lines = [`# Chat with ${entityName}\n`];
  for (const msg of messages) {
    const ts = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === 'user' ? 'You' : entityName;
    lines.push(`**${role}** _(${ts})_\n`);
    lines.push(msg.content);
    lines.push('\n---\n');
  }
  return lines.join('\n');
}

export function formatChatAsText(
  entityName: string,
  messages: ChatMessage[],
): string {
  return messages
    .map((msg) => {
      const ts = new Date(msg.timestamp).toLocaleString();
      const role = msg.role === 'user' ? 'You' : entityName;
      return `[${ts}] ${role}: ${msg.content}`;
    })
    .join('\n\n');
}

export function formatChatAsJson(
  entityName: string,
  messages: ChatMessage[],
): string {
  return JSON.stringify(
    {
      entityName,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    },
    null,
    2,
  );
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
