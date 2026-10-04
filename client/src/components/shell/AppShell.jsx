/**
 * Invólucro PWA: altura dinâmica, sem “chrome” de página, cantos suaves só em desktop.
 */
export default function AppShell({ children }) {
  return (
    <div className="flex h-full min-h-0 w-full max-w-[100vw] items-stretch justify-center overflow-hidden bg-[#09090b] touch-manipulation">
      <div className="flex h-full min-h-0 w-full min-w-0 max-w-[1680px] flex-col overflow-hidden md:rounded-lg md:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.55)]">
        {children}
      </div>
    </div>
  );
}
