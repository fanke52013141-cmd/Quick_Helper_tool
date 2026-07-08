// start.js - 启动脚本，清除 NODE_OPTIONS 和 ELECTRON_RUN_AS_NODE 后启动 Electron
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
const env = { ...process.env }
delete env.NODE_OPTIONS
delete env.ELECTRON_RUN_AS_NODE
env.NODE_ENV = 'production'

// 调试日志
const debugLog = path.join(__dirname, 'start-debug.log')
fs.writeFileSync(debugLog,
  `=== Start at ${new Date().toISOString()} ===\n` +
  `ELECTRON_RUN_AS_NODE in env: ${'ELECTRON_RUN_AS_NODE' in env}\n` +
  `ELECTRON_RUN_AS_NODE value: ${env.ELECTRON_RUN_AS_NODE || 'UNSET'}\n` +
  `Electron path: ${electronPath}\n` +
  `Electron exists: ${fs.existsSync(electronPath)}\n` +
  `Working dir: ${__dirname}\n`
)

const child = spawn(electronPath, ['.'], {
  env,
  stdio: 'inherit',
  cwd: __dirname,
})

child.on('error', (err) => {
  fs.appendFileSync(debugLog, `Spawn error: ${err.message}\n`)
})

child.on('exit', (code, signal) => {
  fs.appendFileSync(debugLog, `Exit: code=${code} signal=${signal}\n`)
})

child.on('close', (code) => {
  fs.appendFileSync(debugLog, `Close: code=${code}\n`)
})
