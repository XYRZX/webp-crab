#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="小螃蟹 webp"

echo "═══════════════════════════════════════"
echo "  $APP_NAME - macOS 构建脚本"
echo "═══════════════════════════════════════"

# ── 检查 Node.js ──
if ! command -v node &> /dev/null; then
  echo "✗ 未找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# ── 检查签名证书 ──
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo ""
  echo "⚠ 未找到 Apple Developer 签名证书"
  echo "  请确保已安装证书，或从 Apple Developer 下载后双击安装"
  echo "  证书类型: Developer ID Application"
  echo ""
  read -p "是否继续无签名构建？(y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
  NO_SIGN=true
else
  echo "✓ 签名证书已就绪"
  NO_SIGN=false
fi

# ── 检查公证凭据 ──
if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_ID_PASSWORD:-}" ]; then
  echo "⚠ 未设置 APPLE_ID / APPLE_ID_PASSWORD 环境变量，将跳过公证"
  echo "  构建完成后可手动执行: xcrun notarytool submit ..."
  SKIP_NOTARIZE=true
else
  echo "✓ 公证凭据已就绪"
  SKIP_NOTARIZE=false
fi

# ── 确保 Python 可用（DMG 构建需要）──
if command -v python3 &> /dev/null; then
  export PYTHON_PATH="$(command -v python3)"
elif command -v python &> /dev/null; then
  export PYTHON_PATH="$(command -v python)"
fi

# ── 安装依赖 ──
echo "→ 安装 npm 依赖..."
npm install

# ── 修复 dmgbuild Python 3 兼容性（npm install 会覆盖 node_modules）──
DMG_CORE="node_modules/dmg-builder/vendor/dmgbuild/core.py"
if [ -f "$DMG_CORE" ]; then
  echo "→ 修复 dmgbuild Python 3 兼容性..."
  python3 << 'PYFIX'
import os
core_path = "node_modules/dmg-builder/vendor/dmgbuild/core.py"
with open(core_path, "r") as f:
    lines = f.readlines()

# 找到关键行位置
sys_path_idx = None
from_ds_idx = None
reload_idx = None
for i, line in enumerate(lines):
    if "sys.path.append" in line and sys_path_idx is None:
        sys_path_idx = i
    if line.strip().startswith("from ds_store") and from_ds_idx is None:
        from_ds_idx = i
    if "reload(sys)" in line and reload_idx is None:
        reload_idx = i

# 确保 sys.path.append 在 from ds_store 之前
if sys_path_idx is not None and from_ds_idx is not None and sys_path_idx > from_ds_idx:
    # 提取 sys.path 相关行并移到 from ds_store 之前
    block = lines[sys_path_idx:sys_path_idx+2]
    del lines[sys_path_idx:sys_path_idx+2]
    # 重新计算 from_ds_idx
    for i, line in enumerate(lines):
        if line.strip().startswith("from ds_store"):
            from_ds_idx = i
            break
    for b in reversed(block):
        lines.insert(from_ds_idx, b)

# 修复 reload(sys)
for i, line in enumerate(lines):
    if "reload(sys)" in line:
        lines[i] = line.replace("reload(sys)", "pass  # reload removed")
    if "sys.setdefaultencoding" in line:
        lines[i] = ""

with open(core_path, "w") as f:
    f.writelines(lines)
print("  dmgbuild 已适配 Python 3")
PYFIX
fi

# ── 生成图标 ──
echo "→ 生成应用图标..."
if [ -f "build/icon-source.png" ]; then
  node scripts/generate-icons.js
  echo "✓ 图标已生成"
else
  echo "⚠ 未找到 build/icon-source.png，跳过图标生成"
fi

# ── 清理旧构建 ──
rm -rf dist

# ── 确保 img2webp 有执行权限 ──
chmod +x src/bin/img2webp 2>/dev/null || true

# ── 构建 macOS 安装包 ──
echo "→ 开始构建 macOS 安装包..."

if [ "$NO_SIGN" = true ]; then
  # 无签名构建
  npx electron-builder --mac --publish never -c.mac.identity=null
elif [ "$SKIP_NOTARIZE" = true ]; then
  # 有证书但跳过公证（仅签名）
  npx electron-builder --mac --publish never
else
  # 签名 + 公证
  export APPLE_ID="$APPLE_ID"
  export APPLE_ID_PASSWORD="$APPLE_ID_PASSWORD"
  npx electron-builder --mac --publish never
fi

echo ""
echo "═══════════════════════════════════════"
echo "  ✓ 构建完成！输出目录: dist/"
echo "═══════════════════════════════════════"

# ── 打开输出目录 ──
open dist
