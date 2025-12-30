#!/usr/bin/env node

const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const devDeps = [
  '@rollup/plugin-commonjs@^29.0.0',
  '@rollup/plugin-node-resolve@^16.0.3',
  'rollup@^2.79.2',
  'rollup-plugin-terser@^7.0.2',
  'typescript@^5.9.3',
  '@types/node@^24.10.1'
];

const DEFAULT_FILES = {
  'rollup.config.js': `import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

export default {
  input: 'src/index.js',
  plugins: [ resolve(), commonjs(), terser() ],
  external: [], // list external packages here (keep peer deps external)
  output: [
    {
      file: 'dist/esm/index.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'dist/cjs/index.cjs',
      format: 'cjs',
      sourcemap: true
    }
  ]
};
`,

  'tsconfig.types.json': `{
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "allowJs": true,
    "outDir": "dist/types",
    "rootDir": "src",
    "declarationMap": false,
    "moduleResolution": "node",
    "target": "ES2019",
    "module": "ESNext",
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.js"]
}
`,

  '.gitignore': `# ignore everything by default
*

# allow package metadata files
!package.json
!package-lock.json
!README.md
!LICENSE
!CHANGELOG.md

`,

  '.npmignore': `# the same as .gitignore for this setup:
*
!dist/
!dist/**
!package.json
!README.md
!LICENSE
!CHANGELOG.md
!dist/**/*.d.ts
`,

  'README.md': `# Project

This repository was prepared by the \`roll-up package\` script. Edit this README to explain your project.
`
};

function usage() {
  console.log(`
Usage:
  roll-up --pkg <npm|pnpm|yarn> [options]

Options:
  -h, --help           Help
  -p, --pkg <manager>  Package manager to use for installing devDependencies. one of: npm, pnpm, yarn
  --no-install         Do not install devDependencies
  --force              Overwrite existing generated files
  --name "Your Name"   Author name used in LICENSE (falls back to package.json.author or git config)

Examples:
  roll-up --pkg pnpm
  roll-up --pkg yarn --force --name "Jane"
  roll-up --no-install
`);
}

function parseArgs() {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    usage();
    process.exit(0);
  }

  const out = {
    noInstall: false,
    force: false,
    name: null,
    pkg: 'npm' // default if not provided (but user must pass args to run script per above)
  };

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else if (a === '--no-install') {
      out.noInstall = true;
    } else if (a === '--force') {
      out.force = true;
    } else if (a === '--name') {
      if (raw[i+1]) {
        out.name = raw[i+1];
        i++;
      }
    } else if (a === '--pkg' || a === '-p') {
      if (raw[i+1]) {
        const val = raw[i+1].toLowerCase();
        if (!['npm','pnpm','yarn'].includes(val)) {
          console.error('Unsupported package manager:', raw[i+1]);
          usage();
          process.exit(1);
        }
        out.pkg = val;
        i++;
      } else {
        console.error('--pkg requires a value (npm, pnpm, yarn)');
        usage();
        process.exit(1);
      }
    } else {
      // unknown flags
    }
  }

  return out;
}

async function runCmd(cmd, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(cmd + ' exited ' + code)));
  });
}

async function safeWrite(filePath, content, force = false) {
  const exists = existsSync(filePath);
  if (exists && !force) {
    console.log(`Skipping ${filePath} (exists). Use --force to overwrite.`);
    return false;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(()=>{});
  await fs.writeFile(filePath, content, 'utf8');
  console.log(`Wrote ${filePath}`);
  return true;
}

(async function main(){
  const opts = parseArgs();
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');

  if (!existsSync(pkgPath)) {
    console.error('No package.json found in this directory. Run "npm init" first or run this in a project root.');
    process.exit(1);
  }


  const pkgRaw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const bakPath = path.join(cwd, `package.json.setup-backup.${Date.now()}.json`);
  await fs.writeFile(bakPath, pkgRaw, 'utf8');
  console.log(`Backed up package.json -> ${path.basename(bakPath)}`);

  // Merge fields (keep existing values unless missing)
  const defaults = {
    type: 'module',
    main: 'dist/cjs/index.cjs',
    module: 'dist/esm/index.js',
    exports: {
      ".": {
        "import": "./dist/esm/index.js",
        "require": "./dist/cjs/index.cjs",
        "types": "./dist/types/index.d.ts"
      }
    },
    types: 'dist/types/index.d.ts',
    files: ['dist/'],
    scripts: {
      "build:js": "rollup -c",
      "build:types": "tsc -p tsconfig.types.json",
      "build": "npm run build:js && npm run build:types",
      "prepublishOnly": "npm run build"
    }
  };

  // merge top-level simple keys
  for (const key of ['type','main','module','types','files']) {
    if (!pkg[key]) pkg[key] = defaults[key];
  }

  // merge exports (shallow replace if missing)
  if (!pkg.exports) pkg.exports = defaults.exports;

  // merge scripts (preserve existing scripts)
  pkg.scripts = pkg.scripts || {};
  for (const [k,v] of Object.entries(defaults.scripts)) {
    if (!pkg.scripts[k]) pkg.scripts[k] = v;
  }

  // write updated package.json
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('Updated package.json (merged fields).');

  // create src/index.js if missing (small stub)
  const srcIndex = path.join(cwd, 'src', 'index.js');
  if (!existsSync(srcIndex) || opts.force) {
    await fs.mkdir(path.dirname(srcIndex), { recursive: true });
    const stub = `// src/index.js
/**
 * @returns {string}
 */
export function hello() {
  return 'hello';
}

`;
    await fs.writeFile(srcIndex, stub, 'utf8');
    console.log('Wrote src/index.js (stub).');
  } else {
    console.log('Skipping src/index.js (exists).');
  }

  // create auxiliary files
  for (const [fname, content] of Object.entries(DEFAULT_FILES)) {
    const ok = await safeWrite(path.join(cwd, fname), content, opts.force);
    // noop
  }

  // LICENSE: create if missing
  const licensePath = path.join(cwd, 'LICENSE');
  if (!existsSync(licensePath) || opts.force) {
    const year = new Date().getFullYear();
    const name = opts.name || pkg.author || (await (async ()=>{ // try git config name (best-effort)
      try {
        const { execSync } = require('child_process');
        const n = execSync('git config --get user.name', { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim();
        return n || 'Your Name';
      } catch (e) {
        return 'Your Name';
      }
    })());
    const licenseText = `MIT License

Copyright (c) ${year} ${name}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
    await fs.writeFile(licensePath, licenseText, 'utf8');
    console.log('Wrote LICENSE');
  } else {
    console.log('Skipping LICENSE (exists).');
  }

  // Install devDependencies unless --no-install
  if (opts.noInstall) {
    console.log('Skipping install ( --no-install )');
    console.log('Done. Review and commit the changes if OK.');
    process.exit(0);
  }

  console.log('Installing devDependencies:', devDeps.join(' '));
  try {
    // choose command based on requested package manager
    if (opts.pkg === 'npm') {
      await runCmd('npm', ['install', '--save-dev', ...devDeps], cwd);
    } else if (opts.pkg === 'pnpm') {
      await runCmd('pnpm', ['add', '-D', ...devDeps], cwd);
    } else if (opts.pkg === 'yarn') {
      // yarn add --dev ... (works for Yarn Classic and Yarn v2+ compatibility)
      await runCmd('yarn', ['add', '--dev', ...devDeps], cwd);
    } else {
      throw new Error('Unsupported package manager: ' + opts.pkg);
    }
    console.log('Installed devDependencies.');
    console.log('All done. Run `npm run build` to verify the build works.');
  } catch (err) {
    console.error(`${opts.pkg} install failed:`, err.message);
    if (opts.pkg === 'npm') {
      console.error('You may retry manually: npm install --save-dev ' + devDeps.join(' '));
    } else if (opts.pkg === 'pnpm') {
      console.error('You may retry manually: pnpm add -D ' + devDeps.join(' '));
    } else if (opts.pkg === 'yarn') {
      console.error('You may retry manually: yarn add --dev ' + devDeps.join(' '));
    }
    process.exit(2);
  }

})();
