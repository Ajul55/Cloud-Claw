import { useState, useEffect, useCallback } from 'react';
import type { AdminUser, AuthState } from '../types';

export function useAuth() {
    const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

    const checkSession = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json() as { user: AdminUser };
                setAuth({ status: 'authenticated', user: data.user });
            } else {
                setAuth({ status: 'unauthenticated' });
            }
        } catch {
            setAuth({ status: 'unauthenticated' });
        }
    }, []);

    useEffect(() => {
        void checkSession();
    }, [checkSession]);

    const login = useCallback(async (username: string, password: string): Promise<string | null> => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (res.ok) {
            const data = await res.json() as { user: AdminUser };
            setAuth({ status: 'authenticated', user: data.user });
            return null;
        }

        const err = await res.json() as { error: string };
        if (err.error === 'account_locked')      return 'Account locked due to too many failed attempts. Try again in 15 minutes.';
        if (err.error === 'too_many_attempts')   return 'Too many login attempts. Please wait before trying again.';
        if (err.error === 'invalid_credentials') return 'Invalid username or password.';
        return 'Login failed. Please try again.';
    }, []);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAuth({ status: 'unauthenticated' });
    }, []);

    return { auth, login, logout };
}
