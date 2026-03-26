import { useEffect, useState } from "react";

const BUCKET_URL = "https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev";
const GITHUB_RELEASES = "https://github.com/zdenham/anvil/releases";

export function DownloadButton() {
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${BUCKET_URL}/distribute/version`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch version");
        return res.text();
      })
      .then((v) => setVersion(v.trim()))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2">
        <a
          href={GITHUB_RELEASES}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-medium transition-colors bg-surface-50 text-surface-950 hover:bg-surface-200"
        >
          Download from GitHub
        </a>
      </div>
    );
  }

  const dmgUrl = version
    ? `${BUCKET_URL}/builds/${version}/Anvil-${version}.dmg`
    : "#";

  return (
    <a
      href={dmgUrl}
      className={`inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-medium transition-colors ${
        version
          ? "bg-surface-50 text-surface-950 hover:bg-surface-200"
          : "bg-surface-700 text-surface-400 pointer-events-none"
      }`}
    >
      {version ? "Download for macOS" : "Loading..."}
    </a>
  );
}
