import { ProviderError, requestJson } from './http.js';

// Structured-output chat completion. The caller validates the parsed JSON again with zod;
// model output is never trusted to match the schema. `messages` (prior user/assistant turns)
// may be passed instead of a single `user` string for multi-turn conversations.
export function createOpenAI({ apiKey, model, transcribeModel }) {
  return {
    name: 'openai',
    async completeJson({ system, user, messages, schemaName, schema, maxTokens = 400, timeoutMs = 12000 }) {
      const json = await requestJson('openai', 'https://api.openai.com/v1/chat/completions', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs,
        body: {
          model,
          messages: [{ role: 'system', content: system }, ...(messages ?? [{ role: 'user', content: user }])],
          response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
          max_completion_tokens: maxTokens,
        },
      });
      const msg = json.choices?.[0]?.message;
      if (!msg || msg.refusal) throw new ProviderError('openai', 'no usable response', { code: 'refusal' });
      try {
        return JSON.parse(msg.content);
      } catch {
        throw new ProviderError('openai', 'response was not valid JSON', { code: 'invalid_json' });
      }
    },

    // Speech-to-text for the discovery assistant. Audio is sent once and not stored by TownAnt.
    async transcribe({ buffer, mimeType, filename, language, timeoutMs = 20000 }) {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType }), filename);
      form.append('model', transcribeModel);
      form.append('response_format', 'json');
      if (language) form.append('language', language);
      const json = await requestJson('openai', 'https://api.openai.com/v1/audio/transcriptions', { headers: { Authorization: `Bearer ${apiKey}` }, form, timeoutMs });
      if (typeof json.text !== 'string') throw new ProviderError('openai', 'no transcript', { code: 'invalid_json' });
      return { text: json.text };
    },
  };
}
