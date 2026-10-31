import { viewerTimeZone } from '@townant/shared';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUp, Check, MapPin, Mic, RotateCcw, Square, Store, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { closeAssistant, openAssistant, useAssistantState } from '../lib/assistant.js';
import { formatPrice, imageUrl, minutesLabel } from '../lib/format.js';
import { useApi } from '../lib/hooks.js';
import { cleanQuery, locationLabel, locationQuery, useSearchLocation } from '../lib/location.js';
import { AssistantBadge } from './AssistantMark.jsx';
import { LocationDialog } from './SearchBar.jsx';
import { cx, RatingInline, Spinner } from './ui.jsx';

// TownAnt discovery assistant.
//
// Every business shown comes from the API's published-listing search; the assistant's text after
// a search is written by the server from those results. It cannot book: result cards link to the
// normal service pages, where the customer picks a time and confirms it themselves.
// Conversation history lives only in this tab (sessionStorage) and is sent back with each turn.

const STORE_KEY = 'townant.assistant';
const MAX_SENT_TURNS = 12;
const MAX_RECORD_SECONDS = 30;
const STARTERS = ['Find a barber near me this Saturday', 'Who can clean my apartment next week?', 'Dog grooming with good reviews'];

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canRecord = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

function loadHistory() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    /* storage unavailable */
  }
}

const errorText = (err) => {
  if (err?.status === 429) return 'You have sent a lot of requests in a short time. Please wait a minute and try again, or use the regular search.';
  if (err?.code === 'NETWORK_ERROR') return "You appear to be offline. Check your connection and try again.";
  if (err?.code === 'AI_UNAVAILABLE') return "The assistant isn't available right now. Regular search still works.";
  return 'Something went wrong. Please try again, or use the regular search.';
};

// Whether this visitor can speak to the assistant: server transcription is configured, or the
// browser has its own speech recognition.
export function useVoiceAvailable() {
  const status = useApi('/ai/status');
  return Boolean((status.data?.voice && canRecord) || SpeechRecognition);
}

export function AssistantLauncher({ hidden }) {
  const { open } = useAssistantState();
  return (
    <>
      <AnimatePresence>
        {!open && !hidden && (
          <motion.button
            type="button"
            key="launcher"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => openAssistant()}
            aria-haspopup="dialog"
            // Pinned to the viewport's bottom-right, clear of the phone tab bar and of safe-area insets.
            // The label never wraps and the button never exceeds its containing block (a percentage, not
            // 100vw, so a classic scrollbar can't push it off-screen). Only colours transition: Framer
            // Motion owns the transform.
            className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 inline-flex h-12 max-w-[calc(100%-2rem)] items-center gap-2.5 whitespace-nowrap rounded-full bg-navy pl-1.5 pr-4 text-[0.875rem] font-semibold text-white shadow-pop ring-1 ring-white/10 transition-colors hover:bg-navy-800 focus-visible:outline-offset-4 max-[359px]:gap-2 max-[359px]:pr-3 md:bottom-[max(1.5rem,env(safe-area-inset-bottom))] md:right-[max(1.5rem,env(safe-area-inset-right))]"
          >
            <AssistantBadge size={36} className="bg-white/10" />
            Ask TownAnt
          </motion.button>
        )}
      </AnimatePresence>
      <AssistantPanel />
    </>
  );
}

function AssistantPanel() {
  const { open, prompt, voice: voiceRequested, nonce } = useAssistantState();
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const returnFocus = useRef(null);
  const { location, setLocation, locateDevice, status: locStatus } = useSearchLocation();
  const [locOpen, setLocOpen] = useState(false);
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [speak, setSpeak] = useState(false);
  const status = useApi('/ai/status');
  const voice = useVoiceInput(Boolean(status.data?.voice), (text) => {
    setInput(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  });

  useEffect(() => saveHistory(messages), [messages]);

  // Focus management: into the input on open, back to whatever opened it on close.
  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement;
      setTimeout(() => inputRef.current?.focus(), 60);
    } else if (returnFocus.current) {
      returnFocus.current.focus?.();
      returnFocus.current = null;
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, pending, reduce]);

  const stopSpeaking = useCallback(() => canSpeak && window.speechSynthesis.cancel(), []);
  const close = useCallback(() => {
    voice.cancel();
    stopSpeaking();
    closeAssistant();
  }, [voice, stopSpeaking]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !locOpen && panelRef.current?.contains(document.activeElement)) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, locOpen]);

  const send = useCallback(
    async (raw) => {
      const text = raw.trim().slice(0, 500);
      if (!text || pending) return;
      stopSpeaking();
      const next = [...messages, { role: 'user', content: text }];
      setMessages(next);
      setInput('');
      setPending(true);
      try {
        const turns = next
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
          .slice(-MAX_SENT_TURNS)
          .map(({ role, content }) => ({ role, content: content.slice(0, role === 'user' ? 500 : 1200) }));
        while (turns.length && turns[0].role !== 'user') turns.shift();
        const where = location ? cleanQuery({ ...locationQuery(location), label: locationLabel(location) }) : undefined;
        const { data } = await api('/ai/assistant', { method: 'POST', body: { messages: turns, location: where, timezone: viewerTimeZone() } });
        setMessages((m) => [...m, { role: 'assistant', content: data.reply, data }]);
        if (speak && canSpeak) {
          const u = new SpeechSynthesisUtterance(data.reply);
          u.lang = navigator.language || 'en-US';
          window.speechSynthesis.speak(u);
        }
      } catch (err) {
        setMessages((m) => [...m, { role: 'error', content: errorText(err), query: text }]);
      } finally {
        setPending(false);
      }
    },
    [messages, pending, location, speak, stopSpeaking],
  );

  // Starter requests from elsewhere on the site (e.g. the homepage composer and prompts).
  const handled = useRef(0);
  const startVoice = voice.start;
  useEffect(() => {
    if (!open || handled.current === nonce) return;
    handled.current = nonce;
    if (prompt) send(prompt);
    else if (voiceRequested) startVoice();
  }, [open, prompt, voiceRequested, nonce, send, startVoice]);

  const reset = () => {
    stopSpeaking();
    voice.cancel();
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const lastSuggestions = [...messages].reverse().find((m) => m.role === 'assistant')?.data?.suggestions ?? [];

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            key="assistant"
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-7rem))] sm:w-[420px] sm:overflow-hidden sm:rounded-xl sm:border sm:border-line sm:shadow-pop"
          >
            <header className="flex items-center gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <AssistantBadge size={36} />
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[1rem] font-bold leading-tight text-navy">
                  TownAnt assistant
                </h2>
                <p className="truncate text-caption text-muted">Finds published businesses. You choose and book.</p>
              </div>
              {canSpeak && (
                <button
                  type="button"
                  onClick={() => {
                    if (speak) stopSpeaking();
                    setSpeak((s) => !s);
                  }}
                  aria-pressed={speak}
                  aria-label={speak ? 'Stop reading replies aloud' : 'Read replies aloud'}
                  title={speak ? 'Stop reading replies aloud' : 'Read replies aloud'}
                  className="flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-cloud hover:text-navy"
                >
                  {speak ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
                </button>
              )}
              {messages.length > 0 && (
                <button type="button" onClick={reset} aria-label="Start over" title="Start over" className="flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-cloud hover:text-navy">
                  <RotateCcw size={17} aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={close} aria-label="Close assistant" className="flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-cloud hover:text-navy">
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="flex items-center gap-2 border-b border-line bg-cloud/60 px-4 py-2 text-secondary">
              <MapPin size={15} aria-hidden="true" className="shrink-0 text-teal" />
              <span className="min-w-0 flex-1 truncate text-slate">
                Searching <span className="font-semibold text-navy">{location ? locationLabel(location) : 'anywhere'}</span>
              </span>
              <button type="button" onClick={() => setLocOpen(true)} className="shrink-0 font-semibold text-teal-700 hover:underline">
                Change
              </button>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
              {messages.length === 0 ? (
                <Intro onPick={send} />
              ) : (
                <ol className="flex flex-col gap-4">
                  {messages.map((m, i) => (
                    <li key={i}>
                      <Message message={m} onRetry={() => send(m.query)} />
                    </li>
                  ))}
                  {pending && (
                    <li className="flex items-center gap-2 text-secondary text-muted" role="status">
                      <Spinner className="size-4 text-teal" /> Searching TownAnt…
                    </li>
                  )}
                </ol>
              )}
            </div>

            {lastSuggestions.length > 0 && !pending && (
              <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
                {lastSuggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="h-8 shrink-0 rounded-full border border-line bg-white px-3 text-secondary font-medium text-slate transition hover:border-teal/40 hover:bg-teal-50 hover:text-teal-700">
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-line px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
            >
              {voice.state !== 'idle' && <VoiceStatus voice={voice} />}
              {voice.notice && (
                <p role="alert" className="mb-2 px-1 text-secondary text-muted">
                  {voice.notice}
                </p>
              )}
              {voice.reviewing && input && <p className="mb-2 px-1 text-caption text-muted">Check the transcript and edit it if needed, then send.</p>}
              <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-white p-1.5 transition focus-within:border-teal focus-within:ring-[3px] focus-within:ring-teal/15">
                <label htmlFor={`${titleId}-input`} className="sr-only">
                  Describe what you need
                </label>
                <textarea
                  id={`${titleId}-input`}
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    voice.clearReview();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  maxLength={500}
                  placeholder="What do you need, where and when?"
                  className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-body text-navy placeholder:text-subtle focus:outline-none"
                />
                {voice.supported && (
                  <button
                    type="button"
                    onClick={voice.state === 'recording' || voice.state === 'listening' ? voice.stop : voice.start}
                    disabled={voice.state === 'requesting' || voice.state === 'transcribing' || pending}
                    aria-label={voice.state === 'recording' || voice.state === 'listening' ? 'Stop recording' : 'Speak your request'}
                    className={cx(
                      'flex size-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50',
                      voice.state === 'recording' || voice.state === 'listening' ? 'bg-danger text-white' : 'text-navy hover:bg-cloud',
                    )}
                  >
                    {voice.state === 'recording' || voice.state === 'listening' ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <Mic size={19} aria-hidden="true" />}
                  </button>
                )}
                <button type="submit" disabled={!input.trim() || pending} aria-label="Send" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal text-white transition hover:bg-teal-700 disabled:bg-line-strong">
                  <ArrowUp size={19} aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 px-1 text-caption text-subtle">AI can misunderstand requests. Listings, times and prices come from TownAnt; always check them on the business page.</p>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
      <LocationDialog key={String(locOpen)} open={locOpen} onClose={() => setLocOpen(false)} location={location} setLocation={setLocation} locateDevice={locateDevice} status={locStatus} />
    </>
  );
}

function Intro({ onPick }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card bg-cloud p-4">
        <p className="text-body font-semibold text-navy">Tell me what you need.</p>
        <p className="mt-1 text-secondary text-muted">
          Describe the service, where, and when. I&rsquo;ll search businesses published on TownAnt and explain why each one matches. I can&rsquo;t book for you &mdash; you&rsquo;ll pick a time and confirm it yourself.
        </p>
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-subtle">Try asking</p>
        <ul className="flex flex-col gap-2">
          {STARTERS.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => onPick(s)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3.5 py-2.5 text-left text-secondary font-medium text-slate transition hover:border-teal/40 hover:bg-teal-50 hover:text-teal-700">
                {s}
                <ArrowRight size={15} aria-hidden="true" className="shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Message({ message, onRetry }) {
  if (message.role === 'user') {
    return (
      <div className="ml-10 flex justify-end">
        <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-3.5 py-2.5 text-body text-white">{message.content}</p>
      </div>
    );
  }
  if (message.role === 'error') {
    return (
      <div className="mr-6 rounded-2xl rounded-bl-md border border-amber/40 bg-amber-50 px-3.5 py-2.5 text-secondary text-amber-text" role="alert">
        <p>{message.content}</p>
        <div className="mt-2 flex flex-wrap gap-3 font-semibold">
          {message.query && (
            <button type="button" onClick={onRetry} className="underline">
              Try again
            </button>
          )}
          <Link to={`/search?${new URLSearchParams(cleanQuery({ q: message.query?.slice(0, 100) }))}`} onClick={closeAssistant} className="underline">
            Use regular search
          </Link>
        </div>
      </div>
    );
  }
  const { data } = message;
  const searchHref = data?.searchParams ? `/search?${new URLSearchParams(cleanQuery({ ...data.searchParams, savedLocation: undefined }))}` : null;
  return (
    <div className="mr-2 flex flex-col gap-3">
      <p className="mr-6 whitespace-pre-wrap rounded-2xl rounded-bl-md bg-cloud px-3.5 py-2.5 text-body text-slate">{message.content}</p>
      {data?.results?.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Matching businesses">
          {data.results.map((r) => (
            <li key={r.id}>
              <ResultCard result={r} />
            </li>
          ))}
        </ul>
      )}
      {searchHref && data.total > data.results.length && (
        <Link to={searchHref} onClick={closeAssistant} className="inline-flex w-fit items-center gap-1.5 text-secondary font-semibold text-teal-700 hover:underline">
          See all {data.total} results <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function ResultCard({ result: r }) {
  const image = r.cover ?? r.logo;
  const place = [r.location?.area, r.location?.city].filter(Boolean).join(', ');
  return (
    <article className="overflow-hidden rounded-card border border-line bg-white shadow-card">
      <div className="flex gap-3 p-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-md bg-teal-50 ring-1 ring-line">
          {image ? (
            <img src={imageUrl(image.url, { w: 160, h: 160 })} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-teal-700/70" aria-hidden="true">
              <Store size={22} strokeWidth={1.5} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-card font-semibold text-navy">
            <Link to={`/b/${r.slug}`} onClick={closeAssistant} className="hover:text-teal-700 hover:underline">
              {r.name}
            </Link>
          </h3>
          <p className="truncate text-secondary text-muted">{[r.category?.name, place].filter(Boolean).join(' · ')}</p>
          <RatingInline rating={r.rating} className="mt-0.5" />
        </div>
      </div>
      {r.reasons?.length > 0 && (
        <ul className="flex flex-col gap-1 px-3 pb-2" aria-label="Why it matches">
          {r.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5 text-secondary text-slate">
              <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />
              {reason}
            </li>
          ))}
        </ul>
      )}
      {r.services?.length > 0 && (
        <ul className="border-t border-line">
          {r.services.map((s) => {
            const price = formatPrice(s.price);
            return (
              <li key={s.id} className="border-b border-line last:border-b-0">
                <Link to={`/b/${r.slug}/s/${s.id}`} onClick={closeAssistant} className="flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-teal-50">
                  <span className="min-w-0">
                    <span className="block truncate text-secondary font-semibold text-navy">{s.title}</span>
                    <span className="block text-caption text-muted">{[minutesLabel(s.durationMinutes), price].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-teal-700">
                    See times <ArrowRight size={13} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function VoiceStatus({ voice }) {
  const label = { requesting: 'Waiting for microphone permission…', recording: `Listening… ${voice.seconds}s`, listening: 'Listening…', transcribing: 'Turning your speech into text…' }[voice.state];
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md bg-teal-50 px-3 py-2 text-secondary text-teal-700" role="status">
      <span className="flex items-center gap-2">
        {voice.state === 'recording' || voice.state === 'listening' ? <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden="true" /> : <Spinner className="size-4" />}
        {label}
      </span>
      <button type="button" onClick={voice.cancel} className="font-semibold underline">
        Cancel
      </button>
    </div>
  );
}

/**
 * Voice input. When the API reports transcription is configured, records a short clip and sends it to TownAnt's API for transcription (the API key
 * stays on the server); browsers without MediaRecorder fall back to their built-in speech
 * recognition. Either way the transcript is placed in the text box for the customer to review —
 * it is never sent automatically.
 */
export function useVoiceInput(serverVoice, onTranscript) {
  const [state, setState] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const rec = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const cancelled = useRef(false);
  const timer = useRef(null);
  const recognition = useRef(null);

  const cleanup = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    if (rec.current?.state === 'recording') rec.current.stop();
    recognition.current?.abort();
    cleanup();
  }, [cleanup]);

  const transcribe = useCallback(
    async (blob) => {
      setState('transcribing');
      try {
        const form = new FormData();
        form.append('audio', blob, 'voice');
        const lang = (navigator.language || '').slice(0, 2).toLowerCase();
        if (/^[a-z]{2}$/.test(lang)) form.append('language', lang);
        const { data } = await api('/ai/transcribe', { method: 'POST', form });
        if (cancelled.current) return;
        if (data.text) {
          onTranscript(data.text);
          setReviewing(true);
        } else setNotice("I didn't catch that. Try again, or type your request.");
      } catch (err) {
        if (!cancelled.current) setNotice(err?.status === 429 ? 'Voice input is busy. Wait a minute or type your request.' : "Voice input isn't available right now. Please type your request.");
      } finally {
        if (!cancelled.current) setState('idle');
      }
    },
    [onTranscript],
  );

  const startBrowserRecognition = useCallback(() => {
    const r = new SpeechRecognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => {
      onTranscript(e.results[0][0].transcript);
      setReviewing(true);
    };
    r.onerror = (e) => setNotice(e.error === 'not-allowed' ? 'Microphone permission was declined. You can type your request instead.' : "I didn't catch that. Try again, or type your request.");
    r.onend = () => setState('idle');
    recognition.current = r;
    setState('listening');
    r.start();
  }, [onTranscript]);

  const start = useCallback(async () => {
    setNotice(null);
    setReviewing(false);
    cancelled.current = false;
    // Without server transcription (or recording support), use the browser's recognizer.
    if (!canRecord || !serverVoice) {
      if (SpeechRecognition) startBrowserRecognition();
      else setNotice("Voice input isn't available in this browser. Please type your request.");
      return;
    }
    setState('requesting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setState('idle');
      setNotice(err?.name === 'NotAllowedError' ? 'Microphone permission was declined. You can type your request instead, or allow the microphone in your browser settings.' : "No microphone was found. You can type your request instead.");
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder.isTypeSupported?.(t));
    const recorder = new window.MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    chunks.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    recorder.onstop = () => {
      cleanup();
      if (cancelled.current) {
        setState('idle');
        return;
      }
      const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1000) {
        setState('idle');
        setNotice("That was too short to understand. Hold on a moment longer, then stop.");
        return;
      }
      transcribe(blob);
    };
    rec.current = recorder;
    recorder.start();
    setSeconds(0);
    setState('recording');
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_RECORD_SECONDS && recorder.state === 'recording') recorder.stop();
        return s + 1;
      });
    }, 1000);
  }, [cleanup, serverVoice, startBrowserRecognition, transcribe]);

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop();
    recognition.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (rec.current?.state === 'recording') rec.current.stop();
    recognition.current?.abort();
    cleanup();
    setState('idle');
  }, [cleanup]);

  return { supported: (canRecord && serverVoice) || Boolean(SpeechRecognition), state, seconds, notice, reviewing, start, stop, cancel, clearReview: () => setReviewing(false) };
}
