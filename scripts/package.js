const { spawn } = require('child_process')
const path = require('path')

function bin(name) {
  const ext = process.platform === 'win32' ? '.cmd' : ''
  return path.join(__dirname, '..', 'node_modules', '.bin', name + ext)
}

function hasFlag(flag) {
  return process.argv.includes(flag)
}

const requestedMac = hasFlag('--mac')
const requestedWin = hasFlag('--win')

const mac = requestedMac || (!requestedMac && !requestedWin)
const win = requestedWin || (!requestedMac && !requestedWin)

if (mac && process.platform !== 'darwin') {
  console.error('macOS 安装包只能在 macOS 环境构建，请在 macOS 机器上运行：npm run build -- --mac')
  process.exit(1)
}

const builder = bin('electron-builder')
const args = []

if (mac) args.push('--mac')
if (win) args.push('--win')

args.push('--publish', 'never')

const child = spawn(builder, args, { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code || 0))

