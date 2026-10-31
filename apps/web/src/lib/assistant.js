import { useSyncExternalStore } from 'react';

// Open/close state for the discovery assistant, shared by the launcher and any page that wants
// to open it with a starter request (e.g. the homepage prompts).
let state = { open: false, prompt: null, voice: false, nonce: 0 };
const listeners = new Set();
const set = (next) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

// `prompt` sends a starter request; `voice` starts the microphone flow on open.
export const openAssistant = (prompt = null, { voice = false } = {}) => set({ open: true, prompt, voice, nonce: state.nonce + 1 });
export const closeAssistant = () => set({ open: false, prompt: null, voice: false });

export function useAssistantState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
