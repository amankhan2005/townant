import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, loadToken, saveToken } from './api.js';
import { clearPendingBooking } from './pendingBooking.js';
import { unregisterPush } from './push.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, channels: { email: true, whatsapp: false } });

  // Resolves true once the server has answered. Being offline is not being signed out: with a saved
  // session it resolves false so the caller can try again (an expired session is a 401, which
  // api() handles by clearing the token).
  const refresh = useCallback(async () => {
    const saved = await loadToken();
    try {
      const { data } = await api('/auth/session');
      setState({ loading: false, user: data.user?.role === 'customer' ? data.user : null, channels: data.channels });
      return true;
    } catch (err) {
      if (err.code === 'NETWORK_ERROR' && saved) return false;
      setState((s) => ({ ...s, loading: false, user: null }));
      return true;
    }
  }, []);

  // Restore the saved session at launch, retrying with backoff while the API can't be reached;
  // visitors without a session simply browse signed out.
  useEffect(() => {
    let live = true;
    let timer = null;
    let delay = 3000;
    const attempt = () =>
      refresh().then((done) => {
        if (done || !live) return;
        timer = setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 30000);
      });
    Promise.resolve().then(attempt);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  const signedIn = useCallback(async (data) => {
    await saveToken(data.token);
    setState((s) => ({ ...s, user: data.user }));
  }, []);

  const logout = useCallback(async () => {
    await unregisterPush().catch(() => {});
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    await saveToken(null);
    // A booking waiting for sign-in (with its note) belongs to whoever was using the app; favorites
    // saved on this device stay.
    await clearPendingBooking();
    setState((s) => ({ ...s, user: null }));
  }, []);

  const value = useMemo(() => ({ ...state, refresh, signedIn, logout }), [state, refresh, signedIn, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
