import {build} from 'esbuild';
await build({entryPoints:['src/main.jsx'],bundle:true,loader:{'.md':'text'},minify:true,format:'iife',target:['es2020'],outfile:'../assets/courses-app.js',legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'}});

import {copyFile} from 'node:fs/promises';
await build({entryPoints:['src/pdf-engine.js'],bundle:true,minify:true,format:'esm',target:['es2022'],outfile:'../assets/pdf-reader.js',legalComments:'eof'});
await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','../assets/pdf-worker.mjs');
