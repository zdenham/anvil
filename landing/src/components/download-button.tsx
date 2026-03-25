import { useEffect, useState } from "react";

const BUCKET_URL = "https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev";

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

  if (error) return null;

  const dmgUrl = version
    ? `${BUCKET_URL}/builds/${version}/Anvil-${version}.dmg`
    : "#";
  const zipUrl = version
    ? `${BUCKET_URL}/builds/${version}/Anvil-${version}.zip`
    : "#";

  return (
    <div className="flex flex-col items-center gap-2">
      <a
        href={dmgUrl}
        className={`inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-medium transition-colors ${
          version
            ? "bg-surface-50 text-surface-950 hover:bg-surface-200"
            : "bg-surface-700 text-surface-400 pointer-events-none"
        }`}
      >
        {version ? `Download ${version} for macOS` : "Loading..."}
      </a>
      {version && (
        <a
          href={zipUrl}
          className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
        >
          or download .app bundle
        </a>
      )}
    </div>
  );
}
