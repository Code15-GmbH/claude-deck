import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths are absolute so `rollup -c plugin/rollup.config.mjs` works from the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sdPlugin = path.join(HERE, 'de.code15.claude-sessions.sdPlugin');

export default {
  input: path.join(HERE, 'src', 'plugin.js'),
  output: { file: path.join(sdPlugin, 'bin', 'plugin.js'), format: 'es', sourcemap: false },
  // ws's optional native accelerators are not needed
  external: ['bufferutil', 'utf-8-validate'],
  plugins: [
    json(),
    commonjs(),
    nodeResolve({ browser: false, exportConditions: ['node'], preferBuiltins: true }),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};
