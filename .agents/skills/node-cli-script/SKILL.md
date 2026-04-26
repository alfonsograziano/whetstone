---
name: node-cli-script
description: |
  Write and run Node.js CLI scripts using modern built-in APIs. Use when the
  user asks to build or run a CLI tool, one-off script, or automation task in
  Node.js. Enforces zero-dependency best practices: built-in argument parsing
  (parseArgs), util.styleText for terminal colors, and native Node.js APIs
  instead of third-party packages.
---

# Node.js CLI Script Writer

You write clean, modern Node.js CLI scripts using only built-in Node.js APIs unless the user explicitly asks for a library.

## Core Rules

1. **Argument parsing**: Always use `util.parseArgs` (Node.js 18.3+). Never use `minimist`, `yargs`, `commander`, or manual `process.argv` slicing unless the user explicitly asks.
2. **Terminal styling**: Always use `util.styleText` (Node.js 20.12+) for colored/styled output. Never use `chalk`, `kleur`, `picocolors`, or ANSI escape codes directly unless asked.
3. **File system**: Use `fs/promises` for async file operations.
4. **HTTP**: Use `fetch` (global, Node.js 18+). No `axios`, `node-fetch`, `got`.
5. **Path handling**: Use the `node:path` module. Never concatenate paths with strings.
6. **No `package.json` needed** for single-file scripts. Run directly with `node script.js`.
7. **Module syntax**: Always use ESM (`import`/`export`). Use the `node:` prefix for all built-in imports (e.g. `node:fs`, `node:path`, `node:util`).
8. **Environment variables**: Use the `--env-file` flag to load `.env` files. Never install or import `dotenv`.

## Argument Parsing Pattern

Always use this pattern for CLI argument parsing:

```js
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: 'string', short: 'o' },
    verbose: { type: 'boolean', short: 'v', default: false },
    count:   { type: 'string',  short: 'n', default: '10' },
  },
  allowPositionals: true,
});
```

- Use `type: 'string'` for values, `type: 'boolean'` for flags.
- Numeric options must be declared as `'string'` and converted with `Number(values.count)`.
- `allowPositionals: true` enables bare arguments (e.g. filenames).

## Terminal Styling Pattern

Always import and use `styleText` like this:

```js
import { styleText } from 'node:util';

console.log(styleText('green', '✓ Done'));
console.log(styleText('red', '✗ Error: something went wrong'));
console.log(styleText(['bold', 'cyan'], 'Header'));
console.log(styleText('yellow', `Warning: ${message}`));
```

Available styles: `'bold'`, `'italic'`, `'underline'`, `'dim'`, `'strikethrough'`
Available colors: `'black'`, `'red'`, `'green'`, `'yellow'`, `'blue'`, `'magenta'`, `'cyan'`, `'white'`
Background colors: `'bgRed'`, `'bgGreen'`, `'bgYellow'`, `'bgBlue'`, `'bgMagenta'`, `'bgCyan'`, `'bgWhite'`
Combine styles: pass an array `['bold', 'red']`.

`styleText` respects `NO_COLOR` and TTY detection automatically — no manual checks needed.

## Module System

Always write ESM scripts. Use the `node:` prefix for all built-in imports — it makes it unambiguous that the module is a Node.js built-in, not an npm package:

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, styleText } from 'node:util';
```

Use `import.meta` instead of CommonJS globals:

```js
import.meta.dirname   // equivalent to __dirname  (v20.11+)
import.meta.filename  // equivalent to __filename (v20.11+)
import.meta.main      // equivalent to require.main === module (v22.18+)
```

Top-level `await` works natively in ESM — no wrapper function needed:

```js
const data = await readFile('input.txt', 'utf8');
```

Import JSON files directly (Node.js 22+ stable):

```js
import config from './config.json' with { type: 'json' };
```

## Environment Variables

Never install `dotenv`. Use the built-in `--env-file` flag instead:

```sh
node --env-file=.env script.js
```

Access variables normally via `process.env.MY_VAR`. If multiple env files are needed:

```sh
node --env-file=.env --env-file=.env.local script.js
```

## Script Template

Use this as the baseline for any CLI script:

```js
#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    // define flags here
  },
  allowPositionals: true,
});

// main logic here
```

Run with env file when needed:

```sh
node --env-file=.env script.js [args]
```

## Output Conventions

- Success messages: `styleText('green', '...')`
- Errors: `styleText('red', '...')` — write to `process.stderr`
- Warnings: `styleText('yellow', '...')`
- Section headers / labels: `styleText(['bold', 'cyan'], '...')`
- Dim/secondary info: `styleText('dim', '...')`
- Inline emphasis: nest styleText calls: `styleText('bold', styleText('green', 'value'))`

Example error output:

```js
console.error(styleText('red', `Error: ${err.message}`));
process.exit(1);
```

## Substitution Table (built-ins over packages)

| Package              | Built-in replacement           | Since   |
|----------------------|--------------------------------|---------|
| `chalk` / `picocolors` | `util.styleText`             | v20.12  |
| `minimist` / `yargs` / `commander` | `util.parseArgs`   | v18.3   |
| `node-fetch` / `axios` / `got` | global `fetch`         | v18     |
| `fs-extra`           | `fs/promises` (`cp`, `rm`)     | v17/v14 |
| `glob` / `fast-glob` | `fs.readdir({ recursive: true })` | v20  |
| `uuid`               | `crypto.randomUUID()`          | v14.17  |
| `lodash.clonedeep`   | `structuredClone()`            | v17     |
| `delay` / `sleep`    | `timers/promises` (`setTimeout`) | v15   |

## Your Workflow

1. Clarify any ambiguous requirements by asking questions to the user before writing code.
2. Write the script file (prefer a single `.js` file unless complexity warrants splitting).
3. Make the script executable if on macOS/Linux: `chmod +x script.js`.
4. Run the script with `node script.js [args]` to verify it works.
5. Show the output to the user and explain any flags or usage.
