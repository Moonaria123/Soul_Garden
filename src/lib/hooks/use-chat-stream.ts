'use client';

// SU-088 P0-F: extracted from (main)/entities/[id]/chat/page.tsx.
// Owns the streaming LLM loop + sentence-bubble dispatch +
// background summarization + classified retry for chat turns.
//
// The caller is still responsible for capturing `input`, clearing it,
// and persisting the user's own message. This hook only drives the
// assistant-side generation so the retry action on the error toast
// does not require resurrecting cleared input state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ConsciousnessEntity, UserProfile } from '@/types';
import { CHAT_CONSTANTS } from '@/types';
import { useChatStore } from '@/lib/store/chat-store';
import { useProviderStore } from '@/lib/store/provider-store';
import { useSearchConfigStore } from '@/lib/store/search-config-store';
import {
  buildSystemPrompt,
  buildSummaryPrompt,
  resolveChatReplyStyle,
  isEntityInReplyScope,
} from '@/lib/agents/soul-mapping';
import { callLLMDirect, callLLMDirectFull } from '@/lib/agents/llm-client';
import { useLlmCall } from '@/lib/llm/use-llm-call';
import {
  computeInputTokenBudget,
  truncateMessagesToBudget,
} from '@/lib/llm/token-estimate';
import { useT } from '@/lib/i18n';

interface UseChatStreamArgs {
  entity: ConsciousnessEntity | null;
  userProfile: UserProfile | null;
}

export function useChatStream({ entity, userProfile }: UseChatStreamArgs) {
  const t = useT();
  const { handleError: handleLlmError } = useLlmCall();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const capabilityToastShown = useRef<Set<string>>(new Set());

  // Reset the per-chat capability-toast dedup set when the user switches
  // entities so a new consciousness starts from a clean slate. Without this,
  // a capability hint already shown for entity A would stay suppressed when
  // the user navigates to entity B on a model that also lacks that feature.
  useEffect(() => {
    capabilityToastShown.current.clear();
  }, [entity?.id]);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!entity || isStreaming) return;

      const providerState = useProviderStore.getState();
      const llmOptions = await providerState.getActiveLLMOptions();
      if (!llmOptions) return;

      // SU-ITER-075: capability fallback — skip features the model doesn't
      // advertise so a thinking-disabled model doesn't fail the whole turn.
      const activeProvider =
        providerState.providers.find((p) => p.id === providerState.activeModelConfig.providerId) ??
        providerState.providers.find((p) => p.isDefault) ??
        providerState.providers[0];
      const activeModel = activeProvider?.models.find((m) => m.id === llmOptions.model);
      const modelCaps = activeModel?.capabilities;

      // SU-ITER-094 · P0-1 — soften the AND-clamp: if the model was
      // probed as unsupported (capabilities.xxx === false) but the user
      // still has the toggle on, warn once and **forward the flag
      // anyway**.  Probe results are a hint, not ground truth — model
      // registries rename SKUs constantly and a false negative must not
      // silently drop the user's intent.
      const warnCapMismatch = (cap: string) => {
        if (!capabilityToastShown.current.has(cap)) {
          capabilityToastShown.current.add(cap);
          toast.info(t('chat.capabilitySkipped', { capability: cap }));
        }
      };

      const effectiveThinking = llmOptions.thinkingEnabled;
      const effectiveVision = llmOptions.visionEnabled;
      const effectiveWebSearch = llmOptions.webSearchEnabled;

      if (llmOptions.thinkingEnabled && modelCaps?.thinking === false) warnCapMismatch('Thinking');
      if (llmOptions.visionEnabled && modelCaps?.vision === false) warnCapMismatch('Vision');
      if (llmOptions.webSearchEnabled && modelCaps?.webSearch === false) warnCapMismatch('Web Search');

      // SU-ITER-094 · Phase-B — resolve the active network-search tool.
      //
      // Previous behaviour silently ignored the user's tool selection in
      // Settings and always sent the native `web_search_options` payload.
      // Now, whenever the model's web-search capability is ON for this
      // turn, we consult `useSearchConfigStore` and forward
      // `{searchTool, apiKey, baseUrl, whitelist, maxToolIterations}`
      // to the proxy.  Phase C will consume these to run the tool loop;
      // Phase B only guarantees the envelope is complete.
      //
      // Decryption happens here (client-side) rather than in the route so
      // the DEK never leaves the browser — same pattern as
      // `autoFillQuestionnaire`.  A decryption failure degrades to
      // "no search context" (the user sees native behaviour) rather
      // than aborting the whole chat turn.
      let searchContext: {
        searchTool?: 'llm-native' | 'brave' | 'firecrawl';
        searchToolApiKey?: string;
        searchToolBaseUrl?: string;
        searchWhitelist?: string[];
        maxToolIterations?: number;
      } = {};
      if (effectiveWebSearch) {
        try {
          const searchState = useSearchConfigStore.getState();
          const { activeTool, toolConfigs, whitelists, maxToolIterations } =
            searchState;
          if (activeTool === 'llm-native') {
            searchContext = {
              searchTool: 'llm-native',
              searchWhitelist: whitelists.worldEye,
              maxToolIterations,
            };
          } else {
            const cfg = toolConfigs.find((c) => c.type === activeTool && c.enabled);
            if (cfg) {
              const apiKey = await searchState.getDecryptedApiKey(cfg);
              searchContext = {
                searchTool: activeTool,
                searchToolApiKey: apiKey || undefined,
                searchToolBaseUrl: cfg.baseURL || undefined,
                searchWhitelist: whitelists.worldEye,
                maxToolIterations,
              };
            } else {
              // User picked Brave/Firecrawl but no enabled config exists.
              // Fall back to native rather than silently dropping the
              // intent; the toast is shown once per chat via capability
              // mismatch logic above if the model also lacks native.
              searchContext = {
                searchTool: 'llm-native',
                searchWhitelist: whitelists.worldEye,
                maxToolIterations,
              };
            }
          }
        } catch {
          // Decrypt / store failure — proceed with no search context.
          searchContext = {};
        }
      }

      const rawStyle = resolveChatReplyStyle(userProfile);
      const inScope = isEntityInReplyScope(rawStyle, entity.id);
      const replyStyle = inScope
        ? rawStyle
        : {
            ...rawStyle,
            enableActions: false,
            enableExpressions: false,
            maxSentencesPerReply: 1,
            streamingBubbles: false,
          };

      const chatState = useChatStore.getState();
      const currentSession = chatState.currentSession;

      const systemPrompt = buildSystemPrompt(
        entity.name,
        entity.soulDocs,
        currentSession?.summaries,
        entity.questionnaire.step4,
        userProfile,
        entity.questionnaire.step1,
        replyStyle,
      );

      // SU-ITER-096 · Bug A — the chat-store's `addMessage('user',...)`
      // is called by the page BEFORE this hook runs (optimistic UI),
      // so `currentSession.messages` already ends with the user turn.
      // Previously we also appended `{role:'user', content: userMessage}`
      // at the end of the `messages` array, causing the upstream LLM
      // to see the user's line twice and reply twice.  We now rely
      // on the store alone and throw if that invariant is violated
      // (dev & prod) so a future regression surfaces immediately
      // instead of silently duplicating the turn again.
      const lastStoredMessage = currentSession?.messages.at(-1);
      if (
        !lastStoredMessage ||
        lastStoredMessage.role !== 'user' ||
        lastStoredMessage.content !== userMessage
      ) {
        throw new Error(
          '[use-chat-stream] chat-store was not primed with the user turn before sendMessage() — caller must addMessage("user", ...) first.',
        );
      }

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        // SU-ITER-091-batch2 · P3-01 — pull the history window length
        // from `CHAT_CONSTANTS.RECENT_MESSAGES_WINDOW` instead of
        // re-hardcoding `20` here.  The store's `getRecentMessages`
        // already obeys the same constant, so keeping both sources in
        // sync prevents the assistant from seeing a different history
        // slice than the summariser.
        ...(currentSession?.messages.slice(-CHAT_CONSTANTS.RECENT_MESSAGES_WINDOW) || []).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      // SU-ITER-094 · Phase-D — clamp the outgoing prompt to the
      // model's context window.  `RECENT_MESSAGES_WINDOW` already
      // caps history count, but very long individual messages
      // (pasted documents, long replies) can still blow past an
      // 8k / 32k window.  We estimate tokens with a conservative
      // char heuristic and drop oldest middle messages until the
      // prompt fits inside `contextWindow * 0.7` (leaving 30 % for
      // the reply).  Models without a known window size fall
      // through unchanged.
      const inputBudget = computeInputTokenBudget(activeModel?.contextWindow);
      const { kept: truncatedMessages, droppedCount } = truncateMessagesToBudget(
        messages,
        inputBudget,
      );
      if (droppedCount > 0 && process.env.NODE_ENV !== 'production') {
        console.info(
          `[use-chat-stream] dropped ${droppedCount} history message(s) to fit ${inputBudget} token budget`,
        );
      }

      const useStreamingBubbles =
        replyStyle.streamingBubbles && replyStyle.maxSentencesPerReply > 1;

      const runChatAttempt = async () => {
        setIsStreaming(true);
        setStreamingContent('');
        try {
          if (useStreamingBubbles) {
            // --- Streaming multi-bubble (SU-ITER-067) ---
            let committedLen = 0;
            let bubbleCount = 0;
            const maxBubbles = replyStyle.maxSentencesPerReply;
            let bubbleChain = Promise.resolve();
            const SENTENCE_ENDERS = ['。', '！', '？', '!', '?'];

            const fullContent = await callLLMDirect(
              truncatedMessages,
              {
                apiKey: llmOptions.apiKey,
                baseURL: llmOptions.baseURL,
                model: llmOptions.model,
                temperature: llmOptions.temperature,
                // SU-ITER-093 — use the effective gates (toggle ∧ probe
                // result) so the transmitted flags match what the UI
                // told the user would happen.  thinkingDepth/budget are
                // always forwarded; the proxy only emits them when
                // `thinkingEnabled` is true.
                thinkingEnabled: effectiveThinking,
                thinkingDepth: llmOptions.thinkingDepth,
                thinkingBudget: llmOptions.thinkingBudget,
                visionEnabled: effectiveVision,
                webSearchEnabled: effectiveWebSearch,
                apiType: llmOptions.apiType,
                ...searchContext,
              },
              {
                onChunk: (fullText) => {
                  while (bubbleCount < maxBubbles - 1) {
                    const uncommitted = fullText.slice(committedLen);
                    let firstEnd = -1;
                    for (const ch of SENTENCE_ENDERS) {
                      const idx = uncommitted.indexOf(ch);
                      if (idx >= 0 && (firstEnd < 0 || idx < firstEnd)) firstEnd = idx;
                    }
                    if (firstEnd < 0) break;

                    const sentence = uncommitted.slice(0, firstEnd + 1).trim();
                    committedLen += firstEnd + 1;
                    if (!sentence) continue;

                    const s = sentence;
                    bubbleChain = bubbleChain.then(() => chatState.addMessage('assistant', s));
                    bubbleCount++;
                  }
                  setStreamingContent(fullText.slice(committedLen));
                },
                // SU-ITER-096 · Bug B-3 — soft-degrade toast when the
                // proxy flags that web search was silently dropped.
                onWarning: (_code, meta) => {
                  toast.info(t('chat.webSearchDegraded', { model: meta.model }));
                },
              },
            );

            setStreamingContent('');
            await bubbleChain;
            const remaining = fullContent.slice(committedLen).trim();
            if (remaining) {
              await chatState.addMessage('assistant', remaining);
            } else if (bubbleCount === 0) {
              await chatState.addMessage('assistant', fullContent);
            }
          } else {
            // --- Standard single-bubble ---
            const fullContent = await callLLMDirect(
              truncatedMessages,
              {
                apiKey: llmOptions.apiKey,
                baseURL: llmOptions.baseURL,
                model: llmOptions.model,
                temperature: llmOptions.temperature,
                // SU-ITER-093 — mirrors the streaming-bubble branch.
                thinkingEnabled: effectiveThinking,
                thinkingDepth: llmOptions.thinkingDepth,
                thinkingBudget: llmOptions.thinkingBudget,
                visionEnabled: effectiveVision,
                webSearchEnabled: effectiveWebSearch,
                apiType: llmOptions.apiType,
                ...searchContext,
              },
              {
                onChunk: (text) => setStreamingContent(text),
                // SU-ITER-096 · Bug B-3 — mirrors streaming-bubble branch.
                onWarning: (_code, meta) => {
                  toast.info(t('chat.webSearchDegraded', { model: meta.model }));
                },
              },
            );

            setStreamingContent('');
            await chatState.addMessage('assistant', fullContent);
          }

          const sessionAfter = useChatStore.getState().currentSession;
          if (chatState.getShouldSummarize() && sessionAfter) {
            const lastIdx = sessionAfter.lastSummarizedMessageIndex ?? 0;
            const unsummarized = sessionAfter.messages.slice(
              lastIdx,
              -CHAT_CONSTANTS.RECENT_MESSAGES_WINDOW,
            );
            const summaryPrompt = buildSummaryPrompt(entity.name, unsummarized);

            try {
              const summary = await callLLMDirectFull(
                [{ role: 'user', content: summaryPrompt }],
                {
                  ...llmOptions,
                  temperature: 0.3,
                  // SU-ITER-093 — summary is a short, deterministic
                  // utility call; force all capabilities off so we don't
                  // pay for reasoning / web-search tokens on what is
                  // effectively a compression step.
                  thinkingEnabled: false,
                  visionEnabled: false,
                  webSearchEnabled: false,
                },
              );
              await chatState.addSummary(summary.trim());
            } catch {
              // Summarization failure is not critical.
            }
          }
        } finally {
          setStreamingContent('');
          setIsStreaming(false);
        }
      };

      try {
        await runChatAttempt();
      } catch (error) {
        // SU-088 P0-G: warmly worded toast + single-click retry for
        // retryable categories (network / rate_limit / upstream).
        handleLlmError(error, { onRetry: runChatAttempt });
      }
    },
    [entity, isStreaming, userProfile, handleLlmError, t],
  );

  return { isStreaming, streamingContent, sendMessage };
}
