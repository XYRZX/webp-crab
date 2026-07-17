const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { execFile } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const pkg = require('./package.json')

const isWin = process.platform === 'win32'
const appDir = __dirname.includes('app.asar')
  ? __dirname.replace('app.asar', 'app.asar.unpacked')
  : __dirname
const binPath = path.join(appDir, 'src', 'bin', `img2webp${isWin ? '.exe' : ''}`)

let win

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 650,
    minWidth: 1000,
    minHeight: 600,
    title: `小螃蟹 webp`,
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  // 加载index.html文件
  win.loadFile('./src/index.html')

  // 打开开发者工具
  // win.webContents.openDevTools()

  // 当 window 被关闭，这个事件会被触发。
  win.on('closed', () => {
    // 取消引用 window 对象，如果你的应用支持多窗口的话，
    // 通常会把多个 window 对象存放在一个数组里面，
    // 与此同时，你应该删除相应的元素。
    win = null
  })
}

// Electron 会在初始化后并准备
// 创建浏览器窗口时，调用这个函数。
// 部分 API 在 ready 事件触发后才能使用。
app.on('ready', createWindow)

// 当全部窗口关闭时退出。
app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  // 在macOS上，当单击dock图标并且没有其他窗口打开时，
  // 通常在应用程序中重新创建一个窗口。
  if (win === null) {
    createWindow()
  }
})

ipcMain.on('open-dialog', function (event, options) {
  dialog.showOpenDialog(win, options).then((res) => {
    event.sender.send('selectedItem', res)
  })
})

ipcMain.on('save-dialog', function (event, options) {
  dialog.showSaveDialog(win, options).then((res) => {
    event.sender.send('savePath', res)
  })
})

ipcMain.on('message-dialog', function (event, options) {
  dialog.showMessageBox(win, options)
})

// 预览：生成临时 webp 文件并返回路径
ipcMain.on('generate-preview', function (event, { imgPaths, options }) {
  const tmpFile = path.join(os.tmpdir(), `webp-preview-${Date.now()}.webp`)
  const loop = options.loop
  const args = ['-loop', String(loop), '-d', String(options.d), '-lossy', '-m', '5', '-q', String(options.q)]
  imgPaths.forEach(p => args.push(p))
  args.push('-o', tmpFile)

  const doExec = () => {
    execFile(binPath, args, { windowsHide: true }, (error) => {
      if (error) {
        event.sender.send('preview-result', { error: error.message })
      } else {
        event.sender.send('preview-result', { filePath: tmpFile })
      }
    })
  }

  if (isWin) {
    doExec()
  } else {
    execFile('chmod', ['+x', binPath], doExec)
  }
})

const isMac = process.platform === 'darwin'
const template = [
  // { role: 'appMenu' }
  ...(isMac ? [{
    label: app.getName(),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideothers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }] : []),
  // { role: 'fileMenu' }
  {
    label: 'File',
    submenu: [
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  },
  // { role: 'editMenu' }
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac ? [
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [
            { role: 'startspeaking' },
            { role: 'stopspeaking' }
          ]
        }
      ] : [
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ])
    ]
  },
  // { role: 'viewMenu' }
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forcereload' },
      { type: 'separator' },
      { role: 'resetzoom' },
      { role: 'zoomin' },
      { role: 'zoomout' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  },
  // { role: 'windowMenu' }
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac ? [
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ] : [
        { role: 'close' }
      ])
    ]
  }
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

