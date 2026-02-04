import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actionsDir = path.join(__dirname, 'src', 'actions');
const outDir = path.join(__dirname, 'dist');

// Ensure output directories exist
fs.mkdirSync(path.join(outDir, 'actions'), { recursive: true });

// Get all action files
const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.ts'));

console.log(`Building ${actionFiles.length} actions...`);

// Build all action files
for (const file of actionFiles) {
  await esbuild.build({
    entryPoints: [path.join(actionsDir, file)],
    outdir: path.join(outDir, 'actions'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['@mort/sdk'],  // SDK injected at runtime
    sourcemap: false,
  });
  console.log(`  ✓ ${file}`);
}

// Generate manifest by importing built files
interface ManifestAction {
  slug: string;
  title: string;
  description?: string;
  entryPoint: string;
  contexts: string[];
}

const manifest: {
  version: 1;
  sdkVersion: string;
  actions: ManifestAction[];
} = {
  version: 1,
  sdkVersion: '1.0.0',
  actions: [],
};

for (const file of actionFiles) {
  const jsFile = file.replace('.ts', '.js');
  const modulePath = path.join(outDir, 'actions', jsFile);

  // Clear module cache to ensure fresh import
  const moduleUrl = `file://${modulePath}?t=${Date.now()}`;
  const module = await import(moduleUrl);
  const action = module.default;

  if (!action || !action.id || !action.title || !action.contexts) {
    console.warn(`  ⚠ Skipping ${file}: missing required fields (id, title, contexts)`);
    continue;
  }

  manifest.actions.push({
    slug: action.id,
    title: action.title,
    description: action.description,
    entryPoint: `actions/${jsFile}`,
    contexts: action.contexts,
  });
}

// Write manifest
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`\n✓ Built ${manifest.actions.length} actions`);
console.log(`✓ Manifest written to dist/manifest.json`);
