import React, { useState, useRef, useEffect } from 'react';

interface LoginPageProps {
    onLogin: (username: string, password: string) => Promise<string | null>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState<string | null>(null);
    const [loading, setLoading]   = useState(false);
    const [showPass, setShowPass] = useState(false);
    const usernameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        usernameRef.current?.focus();
    }, []);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (loading) return;

        setError(null);
        setLoading(true);
        try {
            const err = await onLogin(username.trim(), password);
            if (err) setError(err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{
            minHeight: '100vh', width: '100vw',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(145deg, #0f0f13 0%, #16161d 50%, #0f0f13 100%)',
            fontFamily: "'Geist', -apple-system, sans-serif",
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Subtle grid overlay */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
            }} />

            {/* Glow orb */}
            <div style={{
                position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
                width: 480, height: 300,
                background: 'radial-gradient(ellipse, rgba(126,76,230,0.15) 0%, transparent 70%)',
                pointerEvents: 'none',
                filter: 'blur(40px)',
            }} />

            {/* Card */}
            <div style={{
                position: 'relative', zIndex: 1,
                width: '100%', maxWidth: 400,
                margin: '0 24px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20,
                padding: '40px 36px',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
            }}>
                {/* Logo + heading */}
                <div style={{ textAlign: 'center', marginBottom: 36 }}>
                    <div style={{
                        width: 52, height: 52, borderRadius: 14,
                        background: 'linear-gradient(135deg, #7e4ce6, #a78bfa)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 8px 24px rgba(126,76,230,0.35)',
                    }}>
                        <img
                            src="/dashboard/logo.png"
                            alt="Cloud-Claw"
                            style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }}
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>
                    <h1 style={{
                        fontSize: 22, fontWeight: 800, color: '#f9fafb',
                        margin: '0 0 4px', letterSpacing: '-0.5px',
                    }}>
                        Cloud-Claw
                    </h1>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                        AIOps Hub — Internal Dashboard
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.12)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: 10, padding: '10px 14px',
                        marginBottom: 20,
                        fontSize: 12, color: '#fca5a5',
                        lineHeight: 1.5,
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
                    {/* Username */}
                    <div style={{ marginBottom: 14 }}>
                        <label style={{
                            display: 'block', fontSize: 11, fontWeight: 600,
                            color: '#9ca3af', textTransform: 'uppercase',
                            letterSpacing: '.06em', marginBottom: 6,
                        }}>
                            Username
                        </label>
                        <input
                            ref={usernameRef}
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            autoComplete="username"
                            spellCheck={false}
                            disabled={loading}
                            style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 10, padding: '11px 14px',
                                fontSize: 14, color: '#f9fafb',
                                outline: 'none',
                                transition: 'border-color 0.15s ease, background 0.15s ease',
                                fontFamily: 'inherit',
                            }}
                            onFocus={e => {
                                e.currentTarget.style.borderColor = 'rgba(126,76,230,0.6)';
                                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                            }}
                            onBlur={e => {
                                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                            }}
                        />
                    </div>

                    {/* Password */}
                    <div style={{ marginBottom: 24 }}>
                        <label style={{
                            display: 'block', fontSize: 11, fontWeight: 600,
                            color: '#9ca3af', textTransform: 'uppercase',
                            letterSpacing: '.06em', marginBottom: 6,
                        }}>
                            Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPass ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete="current-password"
                                disabled={loading}
                                style={{
                                    width: '100%', boxSizing: 'border-box',
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 10, padding: '11px 44px 11px 14px',
                                    fontSize: 14, color: '#f9fafb',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease, background 0.15s ease',
                                    fontFamily: 'inherit',
                                }}
                                onFocus={e => {
                                    e.currentTarget.style.borderColor = 'rgba(126,76,230,0.6)';
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                }}
                                onBlur={e => {
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(v => !v)}
                                tabIndex={-1}
                                style={{
                                    position: 'absolute', right: 12, top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    padding: 4, color: '#6b7280',
                                    display: 'flex', alignItems: 'center',
                                }}
                            >
                                {showPass ? (
                                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                ) : (
                                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        style={{
                            width: '100%', padding: '12px 0',
                            borderRadius: 10, border: 'none',
                            background: (loading || !username || !password)
                                ? 'rgba(126,76,230,0.4)'
                                : 'linear-gradient(135deg, #7e4ce6, #6d3fc7)',
                            color: '#fff', fontSize: 14, fontWeight: 700,
                            cursor: (loading || !username || !password) ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s ease',
                            fontFamily: 'inherit',
                            boxShadow: (loading || !username || !password)
                                ? 'none'
                                : '0 4px 16px rgba(126,76,230,0.4)',
                        }}
                    >
                        {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                {/* Footer note */}
                <p style={{
                    textAlign: 'center', fontSize: 11,
                    color: '#4b5563', margin: '24px 0 0',
                    lineHeight: 1.5,
                }}>
                    Internal access only · Unauthorized access prohibited
                </p>
            </div>
        </div>
    );
}
