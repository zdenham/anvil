import { AnvilAnimation } from "./components/anvil-animation";
import { DownloadButton } from "./components/download-button";
import { FeatureGrid } from "./components/feature-grid";
import { MarkdownContent } from "./components/markdown-content";
import content from "./content.md?raw";

export function App() {
  return (
    <div className="min-h-screen bg-surface-950 flex flex-col items-center">
      {/* Hero: ASCII animation */}
      <section className="w-full flex justify-center pt-12 pb-8">
        <AnvilAnimation />
      </section>

      {/* Tagline */}
      <section className="w-full max-w-2xl px-6 pb-8">
        <MarkdownContent content={content} />
      </section>

      {/* Download + GitHub */}
      <section className="w-full max-w-2xl px-6 pb-8 flex justify-center items-center gap-3">
        <DownloadButton />
        <a
          href="https://github.com/zdenham/anvil"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-surface-600 rounded-md text-surface-200 hover:text-surface-50 hover:border-surface-400 transition-colors text-sm"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 8 .2Z" />
          </svg>
          Star on GitHub
        </a>
      </section>

      {/* Features */}
      <section className="w-full max-w-3xl px-6 pb-20">
        <FeatureGrid />
      </section>

      {/* Footer */}
      <footer className="w-full max-w-3xl px-6 pb-12 pt-4 border-t border-surface-800">
        <div className="flex items-center justify-center gap-6 text-sm text-surface-500">
          <a
            href="https://discord.gg/tbkAetedSd"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-surface-300 transition-colors"
          >
            Discord
          </a>
          <a
            href="https://github.com/zdenham/anvil"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-surface-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
