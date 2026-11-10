import { spawn } from 'node:child_process'
import { electronBin } from './electron-path.mjs'
const child = spawn(electronBin, ['.', ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
