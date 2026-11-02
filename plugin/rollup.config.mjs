import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';

const sdPlugin = 'de.code15.claude-sessions.sdPlugin';

export default {
  input: 'src/plugin.js',
  output: { file: `${sdPlugin}/bin/plugin.js`, format: 'es', sourcemap: false },
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
