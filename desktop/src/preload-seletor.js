const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seletorDeTela', {
  listar: () => ipcRenderer.invoke('seletor:listar'),
  escolher: (id) => ipcRenderer.invoke('seletor:escolher', id),
});
