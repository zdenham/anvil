const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  mts: "typescript",
  cjs: "javascript",
  cts: "typescript",
  rs: "rust",
  py: "python",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  psm1: "powershell",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  gradle: "groovy",
  groovy: "groovy",
  lua: "lua",
  r: "r",
  scala: "scala",
  clj: "clojure",
  cljs: "clojure",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  fs: "fsharp",
  fsx: "fsharp",
  nim: "nim",
  zig: "zig",
  v: "v",
  d: "d",
  ada: "ada",
  adb: "ada",
  ads: "ada",
  pl: "perl",
  pm: "perl",
  tcl: "tcl",
  asm: "asm",
  s: "asm",
  wasm: "wasm",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  tf: "terraform",
  tfvars: "terraform",
  prisma: "prisma",
  astro: "astro",
};

// Special filenames that map to languages
const FILENAME_MAP: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmakelists: "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  brewfile: "ruby",
  vagrantfile: "ruby",
  justfile: "just",
  "package.json": "json",
  "tsconfig.json": "jsonc",
  ".prettierrc": "json",
  ".eslintrc": "json",
  ".babelrc": "json",
  ".gitignore": "gitignore",
  ".dockerignore": "gitignore",
  ".env": "dotenv",
  ".env.local": "dotenv",
  ".env.development": "dotenv",
  ".env.production": "dotenv",
};

/**
 * Get the Shiki language identifier from a file path.
 * Falls back to "plaintext" for unknown extensions.
 */
export function getLanguageFromPath(filePath: string): string {
  // Check filename first (for special files like Dockerfile, Makefile)
  const filename = filePath.split("/").pop()?.toLowerCase() ?? "";

  // Check exact filename match
  if (FILENAME_MAP[filename]) {
    return FILENAME_MAP[filename];
  }

  // Check filename without extension for things like CMakeLists.txt
  const filenameNoExt = filename.split(".")[0];
  if (FILENAME_MAP[filenameNoExt]) {
    return FILENAME_MAP[filenameNoExt];
  }

  // Get extension
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  return EXTENSION_MAP[ext] ?? "plaintext";
}
