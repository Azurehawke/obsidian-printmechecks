import esbuild from 'esbuild'
import process from 'process'
import builtins from 'builtin-modules'

const prod = process.argv[2] === 'production'

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtins],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  minify: prod,
  outfile: 'main.js',
  // Fonts and the check background are embedded in main.js
  loader: { '.ttf': 'dataurl', '.png': 'dataurl' }
})

if (prod) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
