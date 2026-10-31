export class ProviderError extends Error {
  constructor(provider, message, { status, retryable = false, code } = {}) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

// JSON request with a hard timeout. Response bodies from providers are never logged in full.
export async function requestJson(provider, url, { method = 'POST', headers = {}, body, timeoutMs = 10000, form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: form ? headers : { 'Content-Type': 'application/json', ...headers },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(provider, err.name === 'TimeoutError' ? 'request timed out' : 'network error', { retryable: true });
  }
  const textBody = await res.text();
  let json;
  try {
    json = textBody ? JSON.parse(textBody) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const code = json?.error?.code ?? json?.name ?? json?.error?.type;
    throw new ProviderError(provider, `HTTP ${res.status}${code ? ` (${code})` : ''}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
      code,
    });
  }
  return json;
}
