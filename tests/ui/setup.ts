// DOM-level integration only: jsdom has no layout engine and no Electron sandbox. Layout and
// the real IPC boundary are verified separately by scripts/electron-smoke.cjs.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLButtonElement',
  'HTMLDialogElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'InputEvent',
  'MutationObserver',
  'getComputedStyle',
  'localStorage',
];
for (const name of globals)
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true,
  configurable: true,
});
// jsdom has no top layer: emulate open/close and initial focus of modal dialogs.
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
  this.querySelector<HTMLElement>(
    '[autofocus], input:not([disabled]), select:not([disabled]), button:not([disabled])',
  )?.focus();
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
dom.window.HTMLInputElement.prototype.showPicker = function () {};
