# roll-up

Turning a pure JS package to typed project is annoying, roll-up handles the annoying part.

A CLI tool that transforms a pure JavaScript project with JSDocs into a typed project using Rollup.

## Usage

1. **Setup a project** : `yarn init -y`

2. **In that project**: Run `npx roll-up --pkg <npm|pnpm|yarn>` to initialize the project with Rollup configuration, TypeScript setup, and necessary dependencies.

3. **Write source code**: Create your JavaScript files in the `src/` directory with JSDocs comments for type annotations.

```js
//src/index.js

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 * */
function add(a, b){
   return a + b
}

```

4. **Build the project**: Run `npm run build` to generate minified JavaScript bundles and TypeScript declaration files in the `dist/` folder.

5. **publish**: Run `npm publish` <- only the dist folder will be pushed to npm 

## Notes

- The build process uses `terser()` for minification. Remove it from `rollup.config.js` for a debuggable distribution.
- Supports ESM and CommonJS outputs with source maps.