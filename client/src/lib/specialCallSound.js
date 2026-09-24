export const SPECIAL_CALL_SOUND_STORAGE_KEY = 'discordia:sirene-convite-ativa';

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A preferência é local a este dispositivo e começa sempre desligada. */
export function isSpecialCallSoundEnabled(storage = defaultStorage()) {
  try {
    return storage?.getItem(SPECIAL_CALL_SOUND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSpecialCallSoundEnabled(enabled, storage = defaultStorage()) {
  try {
    if (enabled) storage?.setItem(SPECIAL_CALL_SOUND_STORAGE_KEY, '1');
    else storage?.removeItem(SPECIAL_CALL_SOUND_STORAGE_KEY);
  } catch {
    // localStorage indisponível: a opção vale só até a tela ser fechada.
  }
  return Boolean(enabled);
}

/** Une a preferência local à capacidade assinada pelo servidor. */
export function callInviteSoundFor(user, storage = defaultStorage()) {
  return user?.capabilities?.specialCallSound && isSpecialCallSoundEnabled(storage)
    ? 'sirene'
    : 'padrao';
}
