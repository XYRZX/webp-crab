const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const buildDir = path.join(__dirname, '..', 'build')
const sourcePng = path.join(buildDir, 'icon-source.png')
const outIco = path.join(buildDir, 'icon.ico')
const outIcns = path.join(buildDir, 'icon.icns')

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true })
}

if (!fs.existsSync(sourcePng)) {
  console.error(`缺少源图标：${sourcePng}`)
  process.exit(1)
}

async function buildIco() {
  const pngToIco = require('png-to-ico')
  const buf = await pngToIco(sourcePng)
  fs.writeFileSync(outIco, buf)
}

function buildIcns() {
  if (process.platform !== 'darwin') return

  const iconset = path.join(buildDir, 'icon.iconset')
  if (fs.existsSync(iconset)) {
    fs.rmSync(iconset, { recursive: true, force: true })
  }
  fs.mkdirSync(iconset, { recursive: true })

  const sizes = [16, 32, 128, 256, 512]
  sizes.forEach((size) => {
    execFileSync('sips', ['-z', String(size), String(size), sourcePng, '--out', path.join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), sourcePng, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
  })
  execFileSync('sips', ['-z', '1024', '1024', sourcePng, '--out', path.join(iconset, 'icon_512x512@2x.png')], { stdio: 'ignore' })

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outIcns], { stdio: 'inherit' })
  fs.rmSync(iconset, { recursive: true, force: true })
}

Promise.resolve()
  .then(buildIco)
  .then(() => buildIcns())
  .then(() => {
    console.log(`已生成：${outIco}`)
    if (process.platform === 'darwin') console.log(`已生成：${outIcns}`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

