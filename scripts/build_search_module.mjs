// Builds the self-updating YouTube Music search module.
//
// Bundles ytmusic-api (and its runtime deps) into ONE self-contained CJS file
// committed to the repo under search-module/. The app checks
// raw.githubusercontent.com for a newer version on startup and downloads it —
// so search fixes reach all users WITHOUT shipping a new app release.
//
// To push a search fix to all users:
//   npm update ytmusic-api
//   npm run build:search-module
//   git add search-module && git commit && git push
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('node_modules/ytmusic-api/package.json', 'utf-8'));
mkdirSync('search-module', { recursive: true });

await build({
    stdin: {
        contents: "module.exports = require('ytmusic-api');",
        resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'search-module/ytmusic-bundle.cjs',
    minify: true,
    logLevel: 'info',
});

writeFileSync('search-module/version.json', JSON.stringify({
    package: 'ytmusic-api',
    version: pkg.version,
    builtAt: new Date().toISOString(),
}, null, 4));

console.log(`✅ Built search-module bundle for ytmusic-api@${pkg.version}`);
