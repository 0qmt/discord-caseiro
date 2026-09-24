export const CALL_INVITE_SOUND = Object.freeze({
  DEFAULT: 'padrao',
  SIREN: 'sirene',
});

/** A conta exclusiva é definida por ID no servidor; valor vazio desliga o recurso. */
export function canUseSpecialCallSound(userId, authorizedUserId) {
  const configured = String(authorizedUserId ?? '').trim();
  return Boolean(configured) && String(userId ?? '') === configured;
}

/** Nunca devolve texto livre recebido do cliente. */
export function resolveCallInviteSound(userId, requestedSound, authorizedUserId) {
  return requestedSound === CALL_INVITE_SOUND.SIREN
    && canUseSpecialCallSound(userId, authorizedUserId)
    ? CALL_INVITE_SOUND.SIREN
    : CALL_INVITE_SOUND.DEFAULT;
}
