import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { api } from '../../src/api.js';
import { useAuth } from '../../src/auth.jsx';
import { SignInPrompt } from '../../src/SignInPrompt.jsx';
import { SUPPORT_CATEGORY_LABELS } from '../../src/support.js';
import { Button, ErrorView, Field, FormMessage, Muted, s, SelectSheet, useApi } from '../../src/ui.jsx';

export default function NewSupportRequest() {
  const { user } = useAuth();
  const router = useRouter();
  const categories = useApi(user ? '/support/categories' : null);
  const [form, setForm] = useState({ category: '', subject: '', body: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  if (!user) return <SignInPrompt icon="message-circle" title="Contact TownAnt" text="Sign in so we can reply to you and keep your requests in one place. Answers to common questions are in Help & FAQ — no sign-in needed." reason="support" />;

  // Mirrors the API's rules so problems show next to the field; the API re-validates.
  const problems = {
    category: !form.category ? 'Choose what your request is about.' : null,
    subject: form.subject.trim().length < 4 ? 'Add a short subject (at least 4 characters).' : null,
    body: form.body.trim().length < 10 ? 'Describe the issue in a little more detail.' : null,
  };
  const show = (k) => (touched ? problems[k] : null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setTouched(true);
    if (Object.values(problems).some(Boolean) || pending) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/support/tickets', { method: 'POST', body: { category: form.category, subject: form.subject.trim(), body: form.body.trim() } });
      router.replace(`/support/${data.id}`);
    } catch (err) {
      // What was typed stays in place for another try.
      setError(err);
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        <Muted>We reply in your request and notify you. Please don’t share passwords or card numbers.</Muted>
        {categories.error && !categories.data ? (
          <ErrorView error={categories.error} onRetry={categories.reload} title="Request types didn't load" />
        ) : (
          <SelectSheet label="What is this about?" value={form.category} onChange={set('category')} options={(categories.data ?? []).map((c) => ({ value: c, label: SUPPORT_CATEGORY_LABELS[c] ?? c }))} />
        )}
        {show('category') ? <FormMessage text={show('category')} /> : null}
        <Field label="Subject" required value={form.subject} onChangeText={set('subject')} maxLength={120} error={show('subject')} hint="A few words, e.g. “Booking shows the wrong time”." />
        <Field label="Describe the issue" required value={form.body} onChangeText={set('body')} maxLength={4000} multiline textAlignVertical="top" style={[s.input, { minHeight: 140, paddingTop: 12 }]} error={show('body')} hint="Include booking references (TA-…) if you have them." />
        {error ? <FormMessage text={error.message} /> : null}
        <Button title="Send request" pending={pending} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
