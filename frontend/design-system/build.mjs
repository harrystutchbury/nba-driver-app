import * as esbuild from 'esbuild'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const root = dirname(fileURLToPath(import.meta.url))

mkdirSync(join(root, 'dist'), { recursive: true })

await esbuild.build({
  entryPoints: [join(root, 'src/index.js')],
  bundle: true,
  format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  jsx: 'automatic',
  outfile: join(root, 'dist/index.es.js'),
})

await esbuild.build({
  entryPoints: [join(root, 'src/components.css')],
  bundle: true,
  outfile: join(root, 'dist/index.css'),
})

console.log('Build complete: dist/index.es.js + dist/index.css')
