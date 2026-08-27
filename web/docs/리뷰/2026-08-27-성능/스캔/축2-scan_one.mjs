
import { transformAsync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { reactCompilerPreset } from '@vitejs/plugin-react';
const f=process.argv[2];
const out=(await transformAsync(readFileSync(f,'utf8'),{filename:f,babelrc:false,configFile:false,sourceMaps:false,presets:[reactCompilerPreset(),['@babel/preset-typescript',{isTSX:f.endsWith('.tsx'),allExtensions:true}]]}))?.code||'';
console.log(out.slice(0,1500));
