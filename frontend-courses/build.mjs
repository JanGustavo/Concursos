import {build} from 'esbuild';
await build({entryPoints:['src/main.jsx'],bundle:true,minify:true,format:'iife',target:['es2020'],outfile:'../assets/courses-app.js',legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'}});
