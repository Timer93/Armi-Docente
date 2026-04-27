import React from 'react';

interface AppErrorBoundaryState {
  error: Error | null;
}

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ARMI render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-300">ARMI Docente</p>
          <h1 className="mt-3 text-2xl font-black">No se pudo abrir este modulo</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-200">
            La sesion esta activa, pero un dato local guardado produjo un error al cargar la pantalla inicial.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-900/80 p-3 text-xs text-rose-100">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-900"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={this.props.onReset}
              className="rounded-xl border border-white/20 px-4 py-2 text-sm font-black text-white"
            >
              Volver al login
            </button>
          </div>
        </div>
      </div>
    );
  }
}
