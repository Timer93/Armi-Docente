/// <reference types="vite/client" />

declare module '*.css';
declare const __APP_VERSION__: string;

declare global {
  interface Window {
    armiUpdater?: {
      getSnapshot?: () => any;
      onStateChange?: (callback: (payload: any) => void) => (() => void) | void;
      checkForUpdates?: () => Promise<any>;
      installDownloadedUpdate?: () => Promise<any>;
    };
    armiApp?: {
      onBeforeQuitAttempt?: (callback: () => void | Promise<void>) => (() => void) | void;
      continueQuit?: () => Promise<any>;
      cancelQuit?: () => Promise<any>;
      requestQuit?: () => Promise<any>;
    };
  }
}

export {};
