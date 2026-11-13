import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
// Uses ./node_modules after `npm install`; set NODE_MODULES to point somewhere else.
const NM = process.env.NODE_MODULES || path.resolve('node_modules');
const require = createRequire(NM + '/');
const esbuild = require('esbuild');
const tw = require('tailwindcss');

const js = (await esbuild.build({
  entryPoints: ['src/app.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', jsx: 'automatic',
  nodePaths: [NM], define: { 'process.env.NODE_ENV': '"production"' }, write: false, legalComments: 'none',
})).outputFiles[0].text;

const src = fs.readdirSync('src').filter(f => /\.tsx?$/.test(f)).map(f => fs.readFileSync('src/' + f, 'utf8')).join('\n');
const candidates = [...new Set(src.match(/[A-Za-z0-9_\-:\/\[\]\.%#!]+/g))];
const compiler = await tw.compile(fs.readFileSync('src/tw.css', 'utf8'), {
  base: process.cwd(),
  loadStylesheet: async (id, base) => {
    const p = id === 'tailwindcss' ? NM + '/tailwindcss/index.css' : path.resolve(base, id);
    return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
  },
});
const css = fs.readFileSync('src/tokens.css', 'utf8') + '\n' + compiler.build(candidates);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TripSplit</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anek+Latin:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}
</script>
</body>
</html>
`;
fs.writeFileSync('index.html', html);
console.log('built', (html.length / 1024).toFixed(0) + ' KiB', 'css', (css.length / 1024).toFixed(0) + ' KiB');
