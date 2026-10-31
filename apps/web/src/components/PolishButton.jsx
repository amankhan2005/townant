import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button } from './ui.jsx';

// Suggests a clearer version of the user's text. The suggestion replaces nothing until the
// user chooses "Use suggestion", and they can still edit it before sending.
export function PolishButton({ text, purpose = 'message', onAccept, endpoint = '/ai/polish', body }) {
  const [state, setState] = useState({ status: 'idle' });
  const run = async () => {
    setState({ status: 'loading' });
    try {
      const { data } = await api(endpoint, { method: 'POST', body: body ?? { text, purpose } });
      setState({ status: 'done', suggestion: data.suggestion });
    } catch (error) {
      setState({ status: 'error', error });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="ghost" icon={<Sparkles size={15} aria-hidden="true" />} onClick={run} pending={state.status === 'loading'} disabled={!body && (text ?? '').trim().length < 3}>
          {endpoint === '/ai/polish' ? 'Improve wording' : 'Draft with AI'}
        </Button>
      </div>
      {state.status === 'error' && <p className="text-xs text-muted">{state.error.message}</p>}
      {state.status === 'done' && (
        <div className="rounded-lg border border-amber/40 bg-amber-50 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#7a4f00]">AI suggestion — review before using</p>
          <p className="whitespace-pre-wrap text-slate">{state.suggestion}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAccept(state.suggestion);
                setState({ status: 'idle' });
              }}
            >
              Use suggestion
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setState({ status: 'idle' })}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
