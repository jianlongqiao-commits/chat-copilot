#!/bin/bash
# ── 把天聊下去 · 一键启动 ──────────────────────────────────
# macOS 上双击此文件即可启动应用

cd "$(dirname "$0")"

echo ""
echo "🎙️  正在启动「把天聊下去」..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js，请先安装："
  echo "   brew install node"
  echo ""
  echo "按任意键退出..."
  read -n 1
  exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，正在安装依赖..."
  npm install
  echo ""
fi

# 检查 .env
if [ ! -f ".env" ]; then
  echo "⚠️  未找到 .env 配置文件，正在从模板创建..."
  cp .env.example .env
  echo "📝 请编辑 .env 文件填入你的 API Key，然后重新启动。"
  open .env
  echo ""
  echo "按任意键退出..."
  read -n 1
  exit 0
fi

# 启动服务
npm start &
SERVER_PID=$!

# 等待服务启动
sleep 2

# 打开浏览器
open http://localhost:3000

echo ""
echo "✅ 应用已启动！浏览器中打开了 http://localhost:3000"
echo "   按 Ctrl+C 停止服务"
echo ""

# 等待服务进程
wait $SERVER_PID
