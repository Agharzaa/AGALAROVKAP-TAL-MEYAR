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
  dvxOpen: (direction: string) =>
    ipcRenderer.invoke('meyar:dvx-open', direction === 'sale' ? 'sale' : 'purchase'),
  onDvxFile: (listener: (file: { direction: string; name: string; bytes: Uint8Array }) => void) => {
    const handler = (_event: IpcRendererEvent, file: unknown) => {
      const f = file as { direction?: unknown; name?: unknown; bytes?: unknown };
      if (
        (f?.direction === 'sale' || f?.direction === 'purchase') &&
        typeof f.name === 'string' &&
        f.bytes instanceof Uint8Array
      )
        listener({ direction: f.direction, name: f.name, bytes: f.bytes });
    };
    ipcRenderer.on('meyar:dvx-file', handler);
    return () => ipcRenderer.removeListener('meyar:dvx-file', handler);
  },
  onDvxRefused: (listener: (message: string) => void) => {
    const handler = (_event: IpcRendererEvent, message: unknown) => {
      if (typeof message === 'string') listener(message);
    };
    ipcRenderer.on('meyar:dvx-refused', handler);
    return () => ipcRenderer.removeListener('meyar:dvx-refused', handler);
  },
  onChanged: (listener: (companyId: string) => void) => {
    const handler = (_event: IpcRendererEvent, companyId: unknown) => {
      if (typeof companyId === 'string') listener(companyId);
    };
    ipcRenderer.on('meyar:changed', handler);
    return () => ipcRenderer.removeListener('meyar:changed', handler);
  },
});
