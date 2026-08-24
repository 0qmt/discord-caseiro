import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db.js';

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

export const signToken = (userId) =>
  jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.tokenTtl });

/** Retorna o usuario do token, ou null se invalido/expirado/apagado. */
export function userFromToken(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    return q.get('SELECT * FROM users WHERE id = ?', sub);
  } catch {
    return null;
  }
}

/** Middleware Express: exige Authorization: Bearer <token>. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'nao autenticado' });
  req.user = user;
  next();
}
