require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const zlib = require('zlib');

// ── 从 .env 读取配置 ──────────────────────────────────────
const PORT = process.env.PORT || 3000;
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'openai/gpt-4o-mini';

// 追问触发参数（可在 .env 覆盖，一般不用动）
const SILENCE_THRESHOLD = parseInt(process.env.SILENCE_THRESHOLD) || 3000;
const MIN_INTERVAL = parseInt(process.env.MIN_INTERVAL) || 30000;
const MIN_TEXT_LENGTH = parseInt(process.env.MIN_TEXT_LENGTH) || 100;

// 火山引擎 ASR 配置
const ASR_APP_ID = process.env.ASR_APP_ID || '';
const ASR_ACCESS_TOKEN = process.env.ASR_ACCESS_TOKEN || '';
const ASR_WSS_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream';
const ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration';

const keyConfigured = LLM_API_KEY && !LLM_API_KEY.includes('请在这里');
const asrConfigured = !!(ASR_APP_ID && ASR_ACCESS_TOKEN);

// ── Express 应用 ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 文件上传（脚本/嘉宾资料）────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.post('/api/upload-script', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到文件' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!['.txt', '.md'].includes(ext)) {
    return res.status(400).json({ error: '仅支持 .txt 和 .md 文件' });
  }

  const content = req.file.buffer.toString('utf-8');
  console.log(`📄 收到脚本文件: ${req.file.originalname} (${content.length} 字)`);

  res.json({
    success: true,
    filename: req.file.originalname,
    content: content,
    charCount: content.length
  });
});

// ── LLM 追问生成 API ─────────────────────────────────────
app.post('/api/generate-suggestions', async (req, res) => {
  const { transcript, scriptContent, previousSummary } = req.body;

  if (!transcript || transcript.trim().length === 0) {
    return res.status(400).json({ error: '对话内容为空' });
  }

  if (!keyConfigured) {
    return res.status(500).json({
      error: 'API Key 未配置。请编辑项目根目录的 .env 文件，填入你的 LLM_API_KEY'
    });
  }

  // 构建系统 prompt
  let systemPrompt = `你是一位经验丰富的直播节目编导助理。你的任务是根据直播对话内容，为主持人生成高质量的追问建议。

## 你的工作原则
1. 追问要有深度——不要问"能展开说说吗"这种废话，要具体到嘉宾刚才提到的某个点
2. 追问要有观众视角——想想观众听到这段话会好奇什么
3. 追问要自然——不能让嘉宾觉得突兀，要衔接上下文
4. 每次生成 2-3 个追问建议，按优先级排序
5. 追问建议要简短——主持人只能瞄一眼，每条不超过 30 个字
6. 如果对话正在深入一个有价值的话题，就不要打断，而是生成"深挖当前话题"类型的追问

## 输出格式
直接输出追问建议，每条一行，用序号标注（如 1. 2. 3.）。不需要任何解释或前缀。`;

  if (scriptContent && scriptContent.trim().length > 0) {
    systemPrompt += `\n\n## 节目脚本/嘉宾资料\n${scriptContent.substring(0, 3000)}`;
  }

  let userPrompt = '';
  if (previousSummary) {
    userPrompt += `## 之前的对话摘要\n${previousSummary}\n\n`;
  }
  userPrompt += `## 最近的对话内容\n${transcript.slice(-3000)}`;
  userPrompt += '\n\n请生成 2-3 条追问建议。';

  try {
    const response = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('LLM API 错误:', response.status, errText);
      return res.status(response.status).json({
        error: `LLM 请求失败 (${response.status})`,
        detail: errText
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`💡 生成追问建议:\n${content}`);

    res.json({
      success: true,
      suggestions: content,
      model: data.model || LLM_MODEL,
      usage: data.usage
    });
  } catch (err) {
    console.error('LLM 调用异常:', err.message);
    res.status(500).json({ error: '调用 LLM 失败: ' + err.message });
  }
});

// ── 获取当前配置（前端读取用，不暴露 key）────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    silenceThreshold: SILENCE_THRESHOLD,
    minInterval: MIN_INTERVAL,
    minTextLength: MIN_TEXT_LENGTH,
    model: LLM_MODEL,
    hasApiKey: keyConfigured,
    hasAsrConfig: asrConfigured
  });
});

// ══════════════════════════════════════════════════════════
//  火山引擎 ASR WebSocket 二进制协议
// ══════════════════════════════════════════════════════════

// 消息类型
const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY_REQUEST  = 0b0010;
const MSG_FULL_SERVER_RESPONSE = 0b1001;
const MSG_SERVER_ACK          = 0b1011;
const MSG_SERVER_ERROR        = 0b1111;

// 序列化方式
const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;

// 压缩方式
const COMPRESS_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;

/**
 * 构建火山引擎 ASR 二进制协议帧
 * Header: 4 bytes
 *   bits 0-3:   protocol version (1)
 *   bits 4-7:   header size in 4-byte units (1 = 4 bytes)
 *   bits 8-11:  message type
 *   bits 12-15: message type flags
 *   bits 16-19: serialization method
 *   bits 20-23: compression method
 *   bits 24-31: reserved (0)
 * Payload Size: 4 bytes (big-endian uint32)
 * Payload: variable
 */
function buildFrame(messageType, payload, flags = 0, serialization = SERIAL_NONE, compression = COMPRESS_NONE) {
  const headerByte0 = (0b0001 << 4) | 0b0001; // version=1, header_size=1 (4 bytes)
  const headerByte1 = (messageType << 4) | (flags & 0x0F);
  const headerByte2 = (serialization << 4) | (compression & 0x0F);
  const headerByte3 = 0x00; // reserved

  const header = Buffer.from([headerByte0, headerByte1, headerByte2, headerByte3]);
  const payloadSize = Buffer.alloc(4);
  payloadSize.writeUInt32BE(payload.length, 0);

  return Buffer.concat([header, payloadSize, payload]);
}

/**
 * 构建 Full Client Request 帧（JSON payload，无压缩）
 */
function buildFullClientRequest(config) {
  const jsonStr = JSON.stringify(config);
  const payload = Buffer.from(jsonStr, 'utf-8');
  return buildFrame(MSG_FULL_CLIENT_REQUEST, payload, 0, SERIAL_JSON, COMPRESS_NONE);
}

/**
 * 构建 Audio Only Request 帧
 * flags: 0b0000 = 正常音频, 0b0010 = 最后一包
 */
function buildAudioFrame(audioData, isLast = false) {
  const flags = isLast ? 0b0010 : 0b0000;
  return buildFrame(MSG_AUDIO_ONLY_REQUEST, audioData, flags, SERIAL_NONE, COMPRESS_NONE);
}

/**
 * 解析火山引擎 ASR 服务端响应帧
 */
function parseServerResponse(data) {
  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data);
  }

  if (data.length < 8) {
    return { type: 'error', message: '响应帧太短' };
  }

  const headerByte0 = data[0];
  const headerByte1 = data[1];
  const headerByte2 = data[2];

  const headerSize = (headerByte0 & 0x0F) * 4; // header size in bytes
  const messageType = (headerByte1 >> 4) & 0x0F;
  const messageFlags = headerByte1 & 0x0F;
  const serialization = (headerByte2 >> 4) & 0x0F;
  const compression = headerByte2 & 0x0F;

  // 服务端响应帧格式: header(4) + sequence(4) + payloadSize(4) + payload
  const sequence = data.readUInt32BE(headerSize);
  const payloadSize = data.readUInt32BE(headerSize + 4);
  const payloadStart = headerSize + 8;
  let payload = data.slice(payloadStart, payloadStart + payloadSize);

  // 解压
  if (compression === COMPRESS_GZIP && payload.length > 0) {
    try {
      payload = zlib.gunzipSync(payload);
    } catch (e) {
      return { type: 'error', message: 'Gzip 解压失败: ' + e.message };
    }
  }

  // 解析
  if (messageType === MSG_FULL_SERVER_RESPONSE) {
    if (serialization === SERIAL_JSON && payload.length > 0) {
      try {
        const json = JSON.parse(payload.toString('utf-8'));
        return { type: 'result', data: json };
      } catch (e) {
        return { type: 'error', message: 'JSON 解析失败: ' + e.message };
      }
    }
    return { type: 'result', data: {} };
  }

  if (messageType === MSG_SERVER_ACK) {
    return { type: 'ack' };
  }

  if (messageType === MSG_SERVER_ERROR) {
    let errMsg = '未知服务端错误';
    if (serialization === SERIAL_JSON && payload.length > 0) {
      try {
        const json = JSON.parse(payload.toString('utf-8'));
        errMsg = json.message || json.error || JSON.stringify(json);
      } catch (e) {
        errMsg = payload.toString('utf-8');
      }
    }
    return { type: 'error', message: errMsg };
  }

  return { type: 'unknown', messageType };
}

// ══════════════════════════════════════════════════════════
//  WebSocket 服务器（前端 ↔ 后端 ↔ 火山引擎）
// ══════════════════════════════════════════════════════════

const wss = new WebSocketServer({ server, path: '/asr' });
let connectionCounter = 0;

wss.on('connection', (clientWs) => {
  const connId = ++connectionCounter;
  const connUid = crypto.randomUUID();
  console.log(`[ASR ${connId}] 前端已连接`);

  let volcWs = null;
  let volcConnected = false;
  let initSent = false;
  let audioQueue = []; // 缓冲连接建立前的音频

  // ── 连接火山引擎 ────────────────────────────────────────
  function connectVolcengine() {
    if (!asrConfigured) {
      clientWs.send(JSON.stringify({
        type: 'error',
        message: 'ASR 未配置，请在 .env 中设置 ASR_APP_ID 和 ASR_ACCESS_TOKEN'
      }));
      return;
    }

    const connectId = crypto.randomUUID();
    const headers = {
      'X-Api-App-Key': ASR_APP_ID,
      'X-Api-Access-Key': ASR_ACCESS_TOKEN,
      'X-Api-Resource-Id': ASR_RESOURCE_ID,
      'X-Api-Connect-Id': connectId,
    };

    console.log(`[ASR ${connId}] 正在连接火山引擎... (connect-id: ${connectId})`);

    volcWs = new WebSocket(ASR_WSS_ENDPOINT, { headers });

    volcWs.on('open', () => {
      volcConnected = true;
      console.log(`[ASR ${connId}] 火山引擎连接成功`);

      // 发送 Full Client Request（初始化配置）
      const initPayload = {
        user: {
          uid: connUid
        },
        audio: {
          format: 'pcm',
          rate: 16000,
          bits: 16,
          channel: 1
        },
        request: {
          model_name: 'bigmodel',
          enable_punc: true,
          enable_itn: true,
          enable_ddc: false,
          result_type: 'single'
        }
      };

      const initFrame = buildFullClientRequest(initPayload);
      console.log(`[ASR ${connId}] 初始化帧: ${initFrame.length} bytes, header: ${initFrame.slice(0, 8).toString('hex')}`);
      console.log(`[ASR ${connId}] 初始化 JSON: ${JSON.stringify(initPayload)}`);
      volcWs.send(initFrame);
      initSent = true;
      console.log(`[ASR ${connId}] 已发送初始化配置`);

      // 通知前端就绪
      clientWs.send(JSON.stringify({ type: 'ready' }));

      // 发送缓冲的音频数据
      while (audioQueue.length > 0) {
        const chunk = audioQueue.shift();
        const frame = buildAudioFrame(chunk);
        volcWs.send(frame);
      }
    });

    volcWs.on('message', (data) => {
      const parsed = parseServerResponse(data);

      if (parsed.type === 'result') {
        // 提取识别结果
        const result = parsed.data;
        if (result && result.result) {
          const text = result.result.text || '';
          const definite = result.result.definite !== undefined ? result.result.definite : true;
          const utterances = result.result.utterances || [];

          clientWs.send(JSON.stringify({
            type: 'asr_result',
            text: text,
            definite: definite,
            utterances: utterances
          }));
        } else if (result && result.payload_msg) {
          // 兼容另一种响应格式
          const text = result.payload_msg.result?.text || '';
          const definite = result.payload_msg.result?.definite !== undefined
            ? result.payload_msg.result.definite : true;

          clientWs.send(JSON.stringify({
            type: 'asr_result',
            text: text,
            definite: definite
          }));
        }
      } else if (parsed.type === 'ack') {
        // 服务端确认，无需转发
      } else if (parsed.type === 'error') {
        console.error(`[ASR ${connId}] 火山引擎错误:`, parsed.message);
        clientWs.send(JSON.stringify({
          type: 'error',
          message: parsed.message
        }));
      }
    });

    volcWs.on('error', (err) => {
      console.error(`[ASR ${connId}] 火山引擎 WS 错误:`, err.message);
      clientWs.send(JSON.stringify({
        type: 'error',
        message: '火山引擎连接错误: ' + err.message
      }));
    });

    volcWs.on('close', (code, reason) => {
      volcConnected = false;
      initSent = false;
      console.log(`[ASR ${connId}] 火山引擎连接关闭 (code: ${code})`);
      // nostream 模式下每段话处理完会自动关闭，需要自动重连
      if (clientWs.readyState === WebSocket.OPEN) {
        console.log(`[ASR ${connId}] 自动重连火山引擎...`);
        clientWs.send(JSON.stringify({ type: 'reconnecting' }));
        setTimeout(() => {
          if (clientWs.readyState === WebSocket.OPEN) {
            connectVolcengine();
          }
        }, 300);
      }
    });
  }

  // ── 处理前端消息 ────────────────────────────────────────
  clientWs.on('message', (data, isBinary) => {
    if (isBinary) {
      // 二进制数据 = 音频 PCM
      const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      if (volcWs && volcConnected && initSent) {
        const frame = buildAudioFrame(audioBuffer);
        if (!this._audioLogCount) this._audioLogCount = 0;
        this._audioLogCount++;
        if (this._audioLogCount <= 5) {
          console.log(`[ASR ${connId}] 发送音频帧 #${this._audioLogCount}: pcm=${audioBuffer.length}bytes, frame=${frame.length}bytes, header=${frame.slice(0,8).toString('hex')}`);
        }
        volcWs.send(frame);
      } else {
        // 连接还没好，先缓存
        audioQueue.push(audioBuffer);
        console.log(`[ASR ${connId}] 音频缓存中 (volcConnected=${volcConnected}, initSent=${initSent}), queue=${audioQueue.length}`);
      }
    } else {
      // 文本消息 = 控制命令
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'start':
            audioQueue = [];
            connectVolcengine();
            break;

          case 'stop':
            if (volcWs && volcConnected && initSent) {
              // 发送最后一包空音频（结束信号）
              const endFrame = buildAudioFrame(Buffer.alloc(0), true);
              volcWs.send(endFrame);
              console.log(`[ASR ${connId}] 已发送结束信号`);
              // 延迟关闭，等待最终结果
              setTimeout(() => {
                if (volcWs && volcWs.readyState === WebSocket.OPEN) {
                  volcWs.close();
                }
              }, 2000);
            }
            break;

          default:
            console.warn(`[ASR ${connId}] 未知消息类型:`, msg.type);
        }
      } catch (e) {
        console.error(`[ASR ${connId}] 消息解析失败:`, e.message);
      }
    }
  });

  // ── 前端断开 ────────────────────────────────────────────
  clientWs.on('close', () => {
    console.log(`[ASR ${connId}] 前端断开`);
    if (volcWs && volcWs.readyState === WebSocket.OPEN) {
      volcWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error(`[ASR ${connId}] 前端 WS 错误:`, err.message);
  });
});

// ── 启动服务 ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║          🎙️  把天聊下去 · AI 副驾            ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  地址: http://localhost:${PORT}`);
  console.log(`║  模型: ${LLM_MODEL}`);
  console.log(`║  LLM: ${keyConfigured ? '已配置 ✅' : '未配置 ❌ → 请编辑 .env 文件'}`);
  console.log(`║  ASR: ${asrConfigured ? '豆包 Seed-ASR 2.0 ✅' : '未配置 ❌ → 请编辑 .env 文件'}`);
  console.log(`║  WS:  ws://localhost:${PORT}/asr`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
