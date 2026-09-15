'use strict';

const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const options = {
  absWorkingDir: root,
  entryPoints: ['app/platform-entry.jsx'],
  outfile: 'public/assets/build/dashboard-react.js',
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  // Never expose process.env or any deployment secret in browser assets.
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
  logLevel: 'info'
};

async function run() {
  if (process.argv.includes('--watch')) {
    const context = await esbuild.context(options);
    await context.watch();
  } else await esbuild.build(options);
}
if (require.main === module) run().catch(() => { process.exitCode = 1; });
module.exports = { options };
