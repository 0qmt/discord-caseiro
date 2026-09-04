import { useState } from 'react';
import { api, setToken } from '../api.js';

export default function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = isRegister
        ? form
        : { email: form.email, password: form.password };
      const { token, user } = await api[isRegister ? 'register' : 'login'](payload);
      setToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>discordia</h1>
        <p className="auth-sub">
          {isRegister ? 'Cria sua conta neste servidor' : 'Entra com a sua conta'}
        </p>

        <label>
          E-mail
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
            required
          />
        </label>

        {isRegister && (
          <label>
            Nome de usuario
            <input
              value={form.username}
              onChange={update('username')}
              minLength={2}
              maxLength={32}
              required
            />
          </label>
        )}

        <label>
          Senha
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Aguarde...' : isRegister ? 'Criar conta' : 'Entrar'}
        </button>

        <button
          type="button"
          className="link"
          onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(null); }}
        >
          {isRegister ? 'Ja tenho conta' : 'Nao tenho conta ainda'}
        </button>
      </form>
    </div>
  );
}
