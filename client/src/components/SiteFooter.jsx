const GITHUB_URL = 'https://github.com/misterfranciscobruno/OpenZap';

export default function SiteFooter({ className = '' }) {
  return (
    <footer
      className={`text-center text-xs text-whatsapp-text-secondary/80 ${className}`.trim()}
    >
      <span>OpenZap · franciscobruno.com</span>
      <span aria-hidden className="mx-1.5 opacity-50">
        ·
      </span>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-whatsapp-text-secondary/90 underline underline-offset-2 transition hover:text-whatsapp-green"
      >
        GitHub
      </a>
    </footer>
  );
}
