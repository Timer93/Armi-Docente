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
      previewPrint?: (options?: { title?: string }) => Promise<{ success: boolean; message?: string }>;
      onPrintRequest?: (callback: () => void) => (() => void);
      notifyStartupReady?: () => void;
      onBeforeQuitAttempt?: (callback: () => void | Promise<void>) => (() => void) | void;
      onBackendRecovered?: (callback: () => void) => (() => void) | void;
      continueQuit?: () => Promise<any>;
      cancelQuit?: () => Promise<any>;
      requestQuit?: () => Promise<any>;
      restartApplication?: () => Promise<any>;
      exitApplication?: () => Promise<any>;
      setStudentContextMenuTarget?: (student: { id: string | number; name: string } | null) => boolean;
      onDeleteStudentFromContextMenu?: (callback: (student: { id: string | number; name: string }) => void) => (() => void) | void;
    };
  }
}

export {};
