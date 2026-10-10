// Sandboxed preload (CommonJS). Exposes a fixed, narrow API; no Node primitives leak.
import electron = require('electron');
import type { IpcRendererEvent } from 'electron';
const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld('meyar', {
  command: (command: unknown) => ipcRenderer.invoke('meyar:command', command),
  query: (query: unknown) => ipcRenderer.invoke('meyar:query', query),
  backup: () => ipcRenderer.invoke('meyar:backup'),
  version: () => ipcRenderer.invoke('meyar:version'),
  saveFile: (defaultName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('meyar:save-file', { defaultName: String(defaultName), bytes }),
  setDirty: (dirty: boolean) => ipcRenderer.send('meyar:dirty', dirty === true),
  zoom: (step?: string) =>
    ipcRenderer.invoke(
      'meyar:zoom',
      step === 'in' || step === 'out' || step === 'reset' ? step : null,
    ),
  onZoom: (listener: (factor: number) => void) => {
    const handler = (_event: IpcRendererEvent, factor: unknown) => {
      if (typeof factor === 'number') listener(factor);
    };
    ipcRenderer.on('meyar:zoom', handler);
    return () => ipcRenderer.removeListener('meyar:zoom', handler);
  },
  onChanged: (listener: (companyId: string) => void) => {
    const handler = (_event: IpcRendererEvent, companyId: unknown) => {
      if (typeof companyId === 'string') listener(companyId);
    };
    ipcRenderer.on('meyar:changed', handler);
    return () => ipcRenderer.removeListener('meyar:changed', handler);
  },
});
