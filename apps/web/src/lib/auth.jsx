import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrfToken } from './api.js';

const AuthContext = createContext(null);

// Holds the signed-in user for the whole web app. The server decides identity and role;
// this state only drives what the interface shows.
export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, mfaRequired: false, channels: { email: true, whatsapp: false } });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api('/auth/session');
      setCsrfToken(data.csrfToken);
      setState({ loading: false, user: data.user, mfaRequired: Boolean(data.mfaRequired), channels: data.channels ?? { email: true, whatsapp: false } });
    } catch {
      setState((s) => ({ ...s, loading: false, user: null }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signedIn = useCallback((data) => {
    setCsrfToken(data.csrfToken);
    setState((s) => ({ ...s, loading: false, user: data.user, mfaRequired: Boolean(data.mfaRequired) }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      setState((s) => ({ ...s, user: null, mfaRequired: false }));
    }
  }, []);

  const value = useMemo(() => ({ ...state, refresh, signedIn, logout }), [state, refresh, signedIn, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
