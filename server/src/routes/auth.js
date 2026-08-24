import { Router } from 'express';
import { config } from '../config.js';
import { q } from '../db.js';
import { checkPassword, hashPassword, requireAuth, signToken } from '../lib/auth.js';
import { newId } from '../lib/ids.js';
import { selfUser } from '../lib/serialize.js';

export const authRoutes = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRoutes.post('/register', async (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ error: 'cadastro desabilitado neste servidor' });
  }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'e-mail invalido' });
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: 'nome de usuario precisa ter de 2 a 32 caracteres' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'a senha precisa ter pelo menos 8 caracteres' });
  }
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) {
    return res.status(409).json({ error: 'ja existe uma conta com esse e-mail' });
  }

  const user = {
    id: newId(),
    email,
    username,
    password_hash: await hashPassword(password),
    avatar_url: null,
    created_at: Date.now(),
  };
  q.run(
    `INSERT INTO users (id, email, username, password_hash, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    user.id, user.email, user.username, user.password_hash, user.avatar_url, user.created_at,
  );

  res.status(201).json({ token: signToken(user.id), user: selfUser(user) });
});

authRoutes.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const user = q.get('SELECT * FROM users WHERE email = ?', email);
  // Mesma resposta pra e-mail inexistente e senha errada, pra nao vazar quem tem conta.
  const ok = user ? await checkPassword(password, user.password_hash) : false;
  if (!ok) return res.status(401).json({ error: 'e-mail ou senha incorretos' });

  res.json({ token: signToken(user.id), user: selfUser(user) });
});

authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({ user: selfUser(req.user) });
});
