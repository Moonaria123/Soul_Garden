/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · RTL smoke for `ChatComposer`.
 *
 * Scope: pure presentational component, no store imports — these tests
 * verify prop wiring (placeholder rendering, send-button disabled logic,
 * onSend callback) without touching the actual chat stream.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatComposer } from './chat-composer';
import type { ConsciousnessEntity } from '@/types';

function makeEntity(): ConsciousnessEntity {
  // Structural fixture — the composer only reads `entity.name`.  Full
  // `ConsciousnessEntity` shape is not worth assembling here; double-cast
  // through `unknown` keeps TS satisfied without pretending the object
  // is round-tripping the complete schema.
  return {
    id: 'ent-1',
    name: '外婆',
    relationship: '亲属',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as ConsciousnessEntity;
}

describe('<ChatComposer />', () => {
  it('disables the send button when input is empty or whitespace-only', () => {
    const onSend = vi.fn();
    const { rerender } = render(
      <ChatComposer
        input=""
        onInputChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
        isStreaming={false}
        hasSpeechAPI={false}
        isListening={false}
        onToggleVoice={() => {}}
        entity={makeEntity()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    // Send button is the only button when hasSpeechAPI=false.
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();

    rerender(
      <ChatComposer
        input="   "
        onInputChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
        isStreaming={false}
        hasSpeechAPI={false}
        isListening={false}
        onToggleVoice={() => {}}
        entity={makeEntity()}
      />,
    );
    expect(screen.getAllByRole('button')[0]).toBeDisabled();
  });

  it('fires onSend when the send button is clicked with non-empty input', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatComposer
        input="你好"
        onInputChange={() => {}}
        onKeyDown={() => {}}
        onSend={onSend}
        isStreaming={false}
        hasSpeechAPI={false}
        isListening={false}
        onToggleVoice={() => {}}
        entity={makeEntity()}
      />,
    );
    await user.click(screen.getAllByRole('button')[0]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables composer while streaming (textarea + send button)', () => {
    render(
      <ChatComposer
        input="hi"
        onInputChange={() => {}}
        onKeyDown={() => {}}
        onSend={vi.fn()}
        isStreaming={true}
        hasSpeechAPI={false}
        isListening={false}
        onToggleVoice={() => {}}
        entity={makeEntity()}
      />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getAllByRole('button')[0]).toBeDisabled();
  });
});
