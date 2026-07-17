const { ipcRenderer } = require('electron')
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')

const isWin = process.platform === 'win32'

const appDir = __dirname.includes('app.asar')
  ? __dirname.replace('app.asar', 'app.asar.unpacked')
  : __dirname

const binPath = path.join(appDir, `/bin/img2webp${isWin ? '.exe' : ''}`)

const accepts = ['png', 'jpg', 'jpeg', 'webp']
let dragTimer = null
let previewTimer = null
let previewToken = 0

new Vue({
  template: `
    <div id="app">
      <!-- 工作区：已选择图片 -->
      <div class="workspace" v-if="hasImg">
        <header class="topbar">
          <div class="brand"><span>🦀</span> WebP 转换器</div>
          <ol class="steps">
            <li class="done">选择图片</li>
            <li class="active">调整参数</li>
            <li>预览并保存</li>
          </ol>
          <button class="ghost-btn" @click="reset">↺ 重新选择</button>
        </header>

        <div class="columns">
          <!-- 步骤一：图片顺序 -->
          <section class="col left">
            <div class="col-head"><span class="step-no">1</span> 图片顺序</div>
            <transition-group name="flip-list" tag="ol" class="img-list">
              <li
                v-for="(d, i) in imgs"
                :key="d.path"
                class="img"
                :class="{ off: !d.enabled }"
                draggable
                @dragstart="dragstart(d, $event)"
                @dragenter="dragenter(d, i)"
                @dragend="dragend"
              >
                <span class="name">{{d.path}}</span>
                <div class="li-actions">
                  <button v-if="hideMode" class="li-btn" @click="toggleEnabled(d)">{{ d.enabled ? '不参与' : '参与' }}</button>
                  <button class="li-btn del" @click="removeImg(i)">删除</button>
                </div>
              </li>
            </transition-group>
            <p class="tip">拖动排序 · 共 {{imgs.length}} 张<template v-if="hideMode"> · 参与 {{activeCount}} 张</template></p>
          </section>

          <!-- 步骤二：转换参数 -->
          <section class="col center">
            <div class="col-head"><span class="step-no">2</span> 转换参数</div>
            <div class="field">
              <label>每帧持续时间 (ms)</label>
              <input type="number" v-model.number="options.d" />
            </div>
            <div class="field">
              <label>压缩质量 (1-100)</label>
              <input type="number" v-model.number="options.q" />
            </div>
            <div class="field">
              <label>循环次数 (0 为无限)</label>
              <input type="number" v-model.number="options.loop" />
            </div>

            <div class="segment-box">
              <div class="seg-top">
                <span class="seg-h">隐藏 / 快捷分段</span>
                <button class="toggle-btn" :class="{ on: hideMode }" @click="toggleHideMode">{{ hideMode ? '✓ 已开启' : '开启' }}</button>
              </div>

              <template v-if="hideMode">
                <p class="seg-tip">可单独隐藏图片，或按位置隔段控制参与，不会删除图片</p>

                <div class="seg-row-inline">
                  <span>分</span>
                  <input type="number" min="2" :max="imgs.length" class="seg-count" v-model.number="segCount" />
                  <span>段 · 最多 {{imgs.length}}</span>
                </div>

                <div class="seg-mode">
                  <button :class="{ active: segMode === 'only' }" @click="segMode = 'only'">仅显示该段</button>
                  <button :class="{ active: segMode === 'hide' }" @click="segMode = 'hide'">隐藏该段</button>
                </div>

                <div class="seg-btns">
                  <button v-for="n in segN" :key="n" @click="applySegment(segN, n - 1, segMode)">段{{ n }}</button>
                </div>

                <div class="seg-actions">
                  <button class="seg-reset" @click="invertSelection">反选</button>
                  <button class="seg-reset" @click="showAll">全部显示</button>
                </div>
              </template>
              <p class="seg-tip" v-else>开启后可隐藏部分图片、按段控制参与效果</p>
            </div>
          </section>

          <!-- 步骤三：预览并保存 -->
          <section class="col preview">
            <div class="col-head"><span class="step-no">3</span> 预览并保存</div>
            <div class="preview-area">
              <img v-if="previewSrc" :src="previewSrc" :key="previewKey" class="preview-img" />
              <div v-else-if="previewError" class="preview-error">{{previewError}}</div>
              <div v-else class="preview-loading">
                <span>生成预览中...</span>
              </div>
            </div>
            <p class="preview-tip">调整参数后自动刷新预览</p>
            <div class="size-info" v-if="previewSrc">
              <span v-if="showWebpSize" class="size-chip webp">WebP 约 {{ formatBytes(previewWebpSize) }}</span>
              <span v-if="showGifSize" class="size-chip gif">GIF {{ gifSizing ? '计算中…' : '约 ' + formatBytes(previewGifSize) }}</span>
            </div>
            <div class="format-select">
              <label :class="{ active: format === 'webp' }">
                <input type="radio" value="webp" v-model="format" /> WebP
              </label>
              <label :class="{ active: format === 'gif' }">
                <input type="radio" value="gif" v-model="format" /> GIF
              </label>
              <label :class="{ active: format === 'both' }">
                <input type="radio" value="both" v-model="format" /> WebP + GIF
              </label>
            </div>
            <button class="primary-btn" @click="save">{{ saveLabel }}</button>
          </section>
        </div>
      </div>

      <!-- 初始状态：选择文件 -->
      <div class="landing" v-else>
        <div class="landing-title">🦀 WebP 转换器</div>
        <div class="landing-sub">将多张相同尺寸的图片合成为 WebP 图片 / 动图</div>
        <div
          class="select-btn"
          @drop.prevent="onFileDrop"
          @dragover.prevent="dragover = true"
          @dragleave.prevent="dragover = false"
        >
          <i class="cross"></i>
          <p>
            {{dragover ? '松开以选择文件' : '点击或拖拽选择文件 / 文件夹'}}<br />
            支持 png、jpg、webp 格式
          </p>
          <button @click="select"></button>
        </div>
      </div>

      <transition name="fade">
        <div class="loading" v-if="loading">
          <div class="base">
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
            <div class="cube"></div>
          </div>
        </div>
      </transition>
    </div>
  `,
  data() {
    return {
      loading: false,

      imgs: [],

      options: {
        loop: 0,
        d: 48,
        q: 100,
      },

      format: 'webp',

      segCount: 2,
      segMode: 'only',
      hideMode: false,

      dragover: false,

      previewSrc: '',
      previewKey: 0,
      previewError: '',
      previewWebpSize: 0,
      previewGifSize: 0,
      gifSizing: false,
    }
  },
  computed: {
    hasImg() {
      return this.imgs && this.imgs.length
    },
    activeImgs() {
      return this.imgs.filter(i => i.enabled)
    },
    activeCount() {
      return this.activeImgs.length
    },
    segN() {
      const n = parseInt(this.segCount, 10)
      const safe = (Number.isInteger(n) && n >= 2) ? n : 2
      const max = this.imgs.length >= 2 ? this.imgs.length : safe
      return Math.min(safe, max)
    },
    saveLabel() {
      if (this.format === 'gif') return '保存 GIF'
      if (this.format === 'both') return '保存 WebP + GIF'
      return '保存 WebP'
    },
    showWebpSize() {
      return this.format === 'webp' || this.format === 'both'
    },
    showGifSize() {
      return this.format === 'gif' || this.format === 'both'
    },
  },
  watch: {
    imgs: {
      handler() {
        this.schedulePreview()
      },
      deep: true,
    },
    'imgs.length'(len) {
      if (this.segCount > len) this.segCount = len
    },
    segCount(val) {
      const n = parseInt(val, 10)
      if (Number.isInteger(n) && n > this.imgs.length) this.segCount = this.imgs.length
    },
    'options.d'() {
      this.schedulePreview()
    },
    'options.q'() {
      this.schedulePreview()
    },
    'options.loop'() {
      this.schedulePreview()
    },
    format() {
      // 切换输出格式时，WebP 大小已在预览时得到，这里按需补算 GIF 大小（不重刷预览图，避免闪烁）
      if (!this.previewSrc) return
      if (this.showGifSize && !this.previewGifSize && !this.gifSizing) {
        this.updateGifSize(previewToken)
      }
    },
  },
  methods: {
    select() {
      ipcRenderer.send('open-dialog', {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images', extensions: accepts },
        ],
      })
      ipcRenderer.once('selectedItem', this.selectedItem)
    },
    selectedItem(event, res) {
      const { canceled, filePaths } = res
      if (!canceled) {
        this.imgs = filePaths.map(path => ({ path, enabled: true }))
      }
    },

    // 切换某张图片是否参与制作（不删除）
    toggleEnabled(d) {
      d.enabled = !d.enabled
    },

    // 删除某张图片
    removeImg(i) {
      this.imgs.splice(i, 1)
    },

    // 快捷分段：将图片按位置隔段分为 segments 段，
    // seg 为目标段（0 基），mode='only' 仅显示该段，mode='hide' 隐藏该段
    applySegment(segments, seg, mode) {
      this.imgs.forEach((img, i) => {
        const inSeg = (i % segments) === seg
        img.enabled = mode === 'only' ? inSeg : !inSeg
      })
    },

    // 全部恢复参与
    showAll() {
      this.imgs.forEach((img) => {
        img.enabled = true
      })
    },
    invertSelection() {
      this.imgs.forEach((img) => {
        img.enabled = !img.enabled
      })
    },
    toggleHideMode() {
      this.hideMode = !this.hideMode
      if (!this.hideMode) this.showAll()
    },

    // 保存成功后回到初始状态，方便继续转换下一组图片（保留已设置的参数）
    reset() {
      if (previewTimer) clearTimeout(previewTimer)
      this.imgs = []
      this.previewSrc = ''
      this.previewError = ''
      this.previewKey = 0
      this.dragover = false
      this.hideMode = false
    },
    save() {
      if (!this.checkPass()) {
        return this.error('参数错误，请检查')
      }
      if (!this.activeCount) {
        return this.error('请至少保留一张参与制作的图片')
      }
      const name = this.activeImgs[0].path.replace(/.+?([^\/]+)\..+?$/, '$1')
      const defaultExt = this.format === 'gif' ? 'gif' : 'webp'
      const filters = this.format === 'gif'
        ? [{ name: 'GIF', extensions: ['gif'] }]
        : this.format === 'both'
          ? [{ name: 'WebP / GIF', extensions: ['webp', 'gif'] }]
          : [{ name: 'WebP', extensions: ['webp'] }]
      ipcRenderer.send('save-dialog', {
        defaultPath: `${name}.${defaultExt}`,
        filters,
      })
      ipcRenderer.once('savePath', this.savePath)
    },
    async savePath(event, res) {
      const { canceled, filePath } = res
      if (canceled || !filePath) return

      // 去掉已有后缀，作为多格式输出的基础名
      const base = filePath.replace(/\.(webp|gif)$/i, '')
      const needWebp = this.format === 'webp' || this.format === 'both'
      const needGif = this.format === 'gif' || this.format === 'both'

      this.loading = true
      try {
        if (needWebp) {
          await this.generateWebp(`${base}.webp`)
        }
        if (needGif) {
          await this.generateGif(`${base}.gif`)
        }
        this.loading = false
        this.success('生成成功')
        this.reset()
      } catch (err) {
        this.loading = false
        this.error(`生成失败：${err && err.message ? err.message : err}`)
      }
    },

    // 使用 img2webp 生成 WebP
    generateWebp(outPath) {
      return new Promise((resolve, reject) => {
        const active = this.activeImgs
        const onepic = active.length === 1
        const loop = onepic ? 1 : this.options.loop
        const args = ['-loop', String(loop)]
        if (!onepic) {
          args.push('-d', String(this.options.d))
        }
        args.push('-lossy', '-m', '5', '-q', String(this.options.q))
        active.forEach((img) => {
          args.push(img.path)
        })
        args.push('-o', outPath)

        const run = () => execFile(binPath, args, { windowsHide: true }, (error) => {
          if (error) reject(new Error(`WebP ${error.message}`))
          else resolve()
        })

        if (isWin) run()
        else execFile('chmod', ['+x', binPath], run)
      })
    },

    // 使用 Canvas + 内置 gifenc 生成 GIF
    async generateGif(outPath) {
      const bytes = await this.encodeGif()
      fs.writeFileSync(outPath, Buffer.from(bytes))
    },

    // 编码 GIF 并返回字节（写盘与大小估算共用）
    async encodeGif() {
      let GIFEncoder, quantize, applyPalette
      try {
        ({ GIFEncoder, quantize, applyPalette } = require('./gifenc.js'))
      } catch (e) {
        throw new Error('GIF 编码器加载失败')
      }

      const paths = this.activeImgs.map(i => i.path)
      let width = 0
      let height = 0
      const frames = []

      for (const p of paths) {
        const img = await this.loadImage(p)
        if (!width) {
          width = img.naturalWidth
          height = img.naturalHeight
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        frames.push(ctx.getImageData(0, 0, width, height).data)
      }

      const onepic = paths.length === 1
      const repeat = onepic ? -1 : (this.options.loop === 0 ? 0 : this.options.loop)
      const delay = this.options.d

      const gif = GIFEncoder()
      frames.forEach((data, idx) => {
        const hasAlpha = this.hasTransparency(data)
        const colorFormat = hasAlpha ? 'rgba4444' : 'rgb565'
        const palette = quantize(data, 256, { format: colorFormat })
        const index = applyPalette(data, palette, colorFormat)
        gif.writeFrame(index, width, height, {
          palette,
          delay,
          repeat,
          transparent: hasAlpha,
          first: idx === 0,
        })
      })
      gif.finish()

      return gif.bytes()
    },

    loadImage(p) {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`无法解码图片：${path.basename(p)}`))
        img.src = 'file://' + encodeURI(p) + '?t=' + Date.now()
      })
    },

    // 检测帧中是否含透明像素
    hasTransparency(data) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true
      }
      return false
    },

    checkPass() {
      return (this.options.loop + '').length > 0 && this.options.loop >= 0
        && (this.options.d + '').length > 0 && this.options.d >= 0
        && (this.options.q + '').length > 0 && this.options.q >= 1
    },

    success(message) {
      ipcRenderer.send('message-dialog', {
        type: 'info',
        message,
      })
    },
    error(message) {
      ipcRenderer.send('message-dialog', {
        type: 'error',
        message,
      })
    },

    // ── 预览相关 ──
    schedulePreview() {
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => {
        this.generatePreview()
      }, 400)
    },

    generatePreview() {
      if (!this.hasImg) return
      this.previewError = ''
      this.previewSrc = ''
      this.previewWebpSize = 0
      this.previewGifSize = 0

      if (!this.activeCount) {
        this.previewError = '请至少保留一张参与制作的图片'
        return
      }

      const token = ++previewToken

      ipcRenderer.send('generate-preview', {
        imgPaths: this.activeImgs.map(i => i.path),
        options: {
          d: this.options.d,
          q: this.options.q,
          loop: this.options.loop,
        },
      })
      ipcRenderer.once('preview-result', (event, res) => {
        if (token !== previewToken) return
        if (res.error) {
          this.previewError = '预览生成失败: ' + res.error
        } else {
          // 加时间戳防止浏览器缓存
          this.previewSrc = 'file://' + res.filePath + '?t=' + Date.now()
          this.previewKey = Date.now()
          try {
            this.previewWebpSize = fs.statSync(res.filePath).size
          } catch (e) {
            this.previewWebpSize = 0
          }
          if (this.showGifSize) {
            this.updateGifSize(token)
          }
        }
      })
    },

    // 在内存中编码一份 GIF 以估算大小（不写盘）
    async updateGifSize(token) {
      this.gifSizing = true
      try {
        const bytes = await this.encodeGif()
        if (token !== previewToken) return
        this.previewGifSize = bytes.length
      } catch (e) {
        if (token === previewToken) this.previewGifSize = 0
      } finally {
        if (token === previewToken) this.gifSizing = false
      }
    },

    // 字节数格式化为可读大小（统一以兆为单位，保留一位小数）
    formatBytes(n) {
      if (!n) return '—'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    },

    // ── 拖拽排序 ──
    dragstart(item, event) {
      event.target.style.opacity = 0.5;
      this.dragItem = item;
      const dragItemIndex = this.imgs.indexOf(this.dragItem);
      this.imgs.splice(dragItemIndex, 1, this.dragItem);
    },

    dragenter(item, i) {
      if (this.dragItem.path === item.path || dragTimer) return;
      const dragItemIndex = this.imgs.indexOf(this.dragItem);
      this.imgs.splice(dragItemIndex, 1);
      const newIndex = this.imgs.indexOf(item);
      this.imgs.splice(
        i < dragItemIndex ? newIndex : newIndex + 1,
        0,
        this.dragItem);
      dragTimer = setTimeout(() => {
        dragTimer = null
      }, 200)
    },

    dragend(event) {
      event.target.style.opacity = '';
    },

    onFileDrop(e) {
      this.dragover = false
      const paths = []
      Array.from(e.dataTransfer.files).forEach((file) => {
        const p = file.path
        let stat
        try {
          stat = fs.statSync(p)
        } catch (err) {
          return
        }
        if (stat.isDirectory()) {
          this.collectDirImages(p).forEach(fp => paths.push(fp))
        } else if (this.isAccepted(p)) {
          paths.push(p)
        }
      })
      if (!paths.length) return
      this.imgs = paths.map(p => ({ path: p, enabled: true }))
    },

    // 判断文件扩展名是否为支持的图片格式（大小写不敏感）
    isAccepted(name) {
      const ext = path.extname(name).slice(1).toLowerCase()
      return accepts.indexOf(ext) !== -1
    },

    // 读取文件夹下的图片（仅顶层），按文件名自然顺序排序
    collectDirImages(dir) {
      let entries = []
      try {
        entries = fs.readdirSync(dir)
      } catch (err) {
        return []
      }
      return entries
        .filter(name => this.isAccepted(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(name => path.join(dir, name))
    },
  },
}).$mount('#app')
