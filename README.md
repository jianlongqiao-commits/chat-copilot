# 🎙️ 把天聊下去 — 直播主持人 AI 副驾

直播时的智能副驾驶。实时语音转文字 + AI 自动生成追问建议，让你再也不冷场。

## 功能

- **实时语音转写** — 右侧面板滚动显示识别出的文字（基于 Chrome Web Speech API）
- **AI 追问建议** — 左侧面板自动生成 2-3 条追问建议，检测到停顿后触发
- **脚本上传** — 直播前上传节目脚本/嘉宾资料（.txt / .md），AI 会参考脚本内容生成更贴合的追问
- **手动触发** — 随时点击按钮或按 `Cmd+Enter` 手动生成追问
- **深色主题** — 直播环境不刺眼，大字号远距离也能看

## 快速开始

### 1. 前置条件

- macOS + Chrome 浏览器
- [Node.js](https://nodejs.org/) 18+（安装：`brew install node`）
- 一个 LLM API Key（推荐 [OpenRouter](https://openrouter.ai/keys)）

### 2. 安装

```bash
cd 把天聊下去-直播主持人AI副驾应用
npm install
```

### 3. 配置 API Key

编辑 `.env` 文件，将 `LLM_API_KEY=` 后面替换成你的真实 Key：

```
LLM_API_KEY=你的OpenRouter_API_Key
LLM_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
LLM_MODEL=openai/gpt-4o-mini
```

> 💡 也支持 302.AI、OpenAI 官方等任何 OpenAI 兼容 API。改 endpoint 和 key 即可。

### 4. 启动

**方式一：命令行**
```bash
npm start
```
然后浏览器打开 http://localhost:3000

**方式二：双击启动**
直接双击 `启动.command` 文件（首次需右键 → 打开，授权运行）

### 5. 使用

1. 选择音频源（麦克风 / BlackHole 虚拟设备）
2. 点击「▶ 开始」
3. Chrome 会弹窗请求麦克风权限，点允许
4. 开始说话，右侧会实时显示识别文字
5. 停顿 3 秒后，左侧自动出现追问建议
6. 点击追问卡片可标记为「已使用」（变灰）
7. 随时可以点「💡 手动追问」按钮强制生成

## 系统音频捕获（线上连线场景）

如果你需要捕获腾讯会议等应用的音频，需要安装 BlackHole 虚拟声卡：

```bash
brew install blackhole-2ch
```

配置步骤：
1. 打开「音频 MIDI 设置」（`/Applications/Utilities/Audio MIDI Setup.app`）
2. 左下角 `+` → 创建「多输出设备」
3. 勾选 `BlackHole 2ch` + 你的耳机
4. 系统设置 → 声音 → 输出 → 选择这个多输出设备
5. 在本应用中选择 `BlackHole 2ch` 作为音频源

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd + Enter` | 手动触发追问生成 |

## 配置说明

`.env` 文件中可调的参数：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | API Key（必填） | - |
| `LLM_ENDPOINT` | API 地址 | OpenRouter |
| `LLM_MODEL` | 模型 | `openai/gpt-4o-mini` |
| `PORT` | 本地端口 | `3000` |
| `SILENCE_THRESHOLD` | 停顿触发阈值（ms） | `3000` |
| `MIN_INTERVAL` | 追问最小间隔（ms） | `30000` |
| `MIN_TEXT_LENGTH` | 触发最小文字量 | `100` |

## 技术栈

- 后端：Node.js + Express
- 前端：纯 HTML/CSS/JS（零构建）
- ASR：Chrome Web Speech API（免费，零依赖）
- LLM：OpenRouter / 任何 OpenAI 兼容 API

## 项目结构

```
├── .env              # 密钥配置（不会提交到 Git）
├── .env.example      # 配置模板
├── .gitignore
├── package.json
├── server.js         # Express 后端
├── public/
│   ├── index.html    # 主界面
│   ├── style.css     # 样式（深色主题）
│   └── app.js        # 前端逻辑
├── 启动.command      # macOS 双击启动脚本
└── README.md
```
