const { contextBridge, ipcRenderer } = require('electron');

// Este preload vale para a janela inteira, inclusive quando ela carrega a
// interface vinda do servidor. A ponte de configuração só é exposta nas
// nossas paginas locais.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('appConfig', {
    ler: () => ipcRenderer.invoke('config:ler'),
    definir: (endereco) => ipcRenderer.invoke('config:definir', endereco),
  });
}

/*
 * Ponte do app de desktop, exposta em qualquer pagina - o processo principal e
 * quem confere se quem chamou e mesmo o nosso servidor (ver main.js). Fazer a
 * checagem la, e nao aqui, e o que evita depender de um `location.origin` que
 * a propria pagina poderia influenciar.
 *
 * Notificacao passa por aqui porque dentro do Electron a API `Notification` do
 * lado do site fica presa em "default" mesmo com a permissao liberada; pelo
 * processo principal ela simplesmente funciona.
 */
contextBridge.exposeInMainWorld('appDesktop', {
  notificar: (payload) => ipcRenderer.send('app:notificar', payload),
  tocarSomDeMencao: () => ipcRenderer.send('app:tocar-som-mencao'),
  /** Alterna o modo de tela cheia nativo da janela do Electron. */
  telaCheia: (ativa) => ipcRenderer.invoke('app:tela-cheia', Boolean(ativa)),
  abrirPlayerTelaCheia: (url) => ipcRenderer.invoke('app:abrir-player-tela-cheia', String(url ?? '')),
  versao: () => ipcRenderer.invoke('app:versao'),
  aoMudarTelaCheia: (callback) => {
    const handler = (_evento, ativa) => callback(Boolean(ativa));
    ipcRenderer.on('app:tela-cheia', handler);
    return () => ipcRenderer.removeListener('app:tela-cheia', handler);
  },
  aoFecharPlayerTelaCheia: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:player-fechou', handler);
    return () => ipcRenderer.removeListener('app:player-fechou', handler);
  },
  /** Avisa o processo principal se a pessoa está numa call agora - decide
   * se uma atualização baixada reinicia na hora ou espera (ver
   * atualizador.js). */
  emCall: (emCall) => ipcRenderer.send('app:em-call', { emCall }),
  /** Assina a deteccao de jogo. Devolve uma funcao pra cancelar. */
  aoDetectarJogo: (callback) => {
    const handler = (_evento, nome) => callback(nome);
    ipcRenderer.on('app:jogo', handler);
    ipcRenderer.send('app:vigiar-jogo');
    return () => {
      ipcRenderer.removeListener('app:jogo', handler);
      ipcRenderer.send('app:parar-vigia-jogo');
    };
  },
});
