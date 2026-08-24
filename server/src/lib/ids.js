import crypto from 'node:crypto';

/** IDs curtos e ordenaveis por tempo (timestamp base36 + aleatorio). */
export function newId() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I, pra ditar por voz
export function newInviteCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
