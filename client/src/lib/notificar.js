/**
 * Notificação do sistema.
 *
 * Tem dois caminhos, e a ordem importa:
 *
 * 1. No app de desktop, a ponte `window.appDesktop` manda o processo
 *    principal do Electron criar a notificação. É o caminho confiável: o
 *    processo principal não depende de permissão nenhuma do lado do site.
 *
 * 2. No navegador, a API `Notification` normal.
 *
 * O motivo do caminho 1 existir: dentro do Electron, `Notification.permission`
 * costuma ficar em "default" pra sempre mesmo com a permissão liberada na
 * sessão, e `requestPermission()` não muda isso. Um guarda do tipo
 * `permission !== 'granted'` então bloqueia TODA notificação no app de
 * desktop, em silêncio - foi exatamente o bug que a gente teve.
 */

const pontE = () => (typeof window !== 'undefined' ? window.appDesktop : null);

/** true quando estamos rodando dentro do app de desktop. */
export const ehDesktop = () => Boolean(pontE()?.notificar);

/** Pede permissão uma vez, sem travar nada se a pessoa recusar. */
export function pedirPermissaoDeNotificacao() {
  // No desktop quem notifica é o processo principal: não há o que pedir.
  if (ehDesktop()) return Promise.resolve('granted');
  if (typeof Notification === 'undefined') return Promise.resolve('denied');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return Notification.requestPermission().catch(() => 'denied');
}

/** Como está a permissão agora - alimenta o aviso na tela de configurações. */
export function estadoDaPermissao() {
  if (ehDesktop()) return 'granted';
  if (typeof Notification === 'undefined') return 'indisponivel';
  return Notification.permission;
}

/**
 * Dispara a notificação. Nunca lança: falhar em notificar não pode derrubar o
 * fluxo de quem chamou.
 */
export function notificar(titulo, corpo, { icone } = {}) {
  try {
    const ponte = pontE();
    if (ponte?.notificar) {
      ponte.notificar({ titulo, corpo, icone });
      return;
    }
    if (typeof Notification === 'undefined') return;
    // Só "denied" é impedimento de verdade. Com "default", tentar é melhor do
    // que desistir: em alguns embutidos a notificação sai mesmo assim, e se
    // não sair o catch abaixo segura.
    if (Notification.permission === 'denied') return;
    const aviso = new Notification(titulo, { body: corpo, icon: icone, silent: false });
    // Clicar leva pro app - no desktop quem faz isso é o processo principal
    // (ver main.js), aqui é o equivalente pro navegador.
    aviso.onclick = () => { window.focus(); aviso.close(); };
  } catch {
    // Navegador sem suporte, contexto não seguro, permissão revogada no meio:
    // nada disso é crítico o bastante pra virar erro na tela.
  }
}
