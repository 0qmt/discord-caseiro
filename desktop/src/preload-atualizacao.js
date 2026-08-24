const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atualizacao', {
  info: () => ipcRenderer.invoke('atualizacao:info'),
  reiniciar: () => ipcRenderer.invoke('atualizacao:reiniciar'),
  adiar: () => ipcRenderer.invoke('atualizacao:adiar'),
});
