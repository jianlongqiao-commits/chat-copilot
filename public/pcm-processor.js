/**
 * AudioWorklet 处理器：将浏览器采集的 Float32 音频转换为 PCM 16bit 单声道
 * 并按指定帧大小分包输出
 *
 * 输入：AudioContext 采样率的 Float32 音频（通常 44100Hz 或 48000Hz）
 * 输出：16kHz 16bit 单声道 PCM 数据包
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.buffer = new Float32Array(0);
    // 每 100ms 的采样点数（按目标采样率计算）
    this.frameSize = this.targetRate * 0.1; // 1600 samples = 3200 bytes per 100ms
  }

  /**
   * 简单的线性插值降采样
   */
  downsample(inputData, inputRate, outputRate) {
    if (inputRate === outputRate) {
      return inputData;
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const frac = srcIndex - srcIndexFloor;
      output[i] = inputData[srcIndexFloor] * (1 - frac) + inputData[srcIndexCeil] * frac;
    }
    return output;
  }

  /**
   * Float32 [-1, 1] → Int16 PCM
   */
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    // 取第一个声道
    const channelData = input[0];

    // 降采样到 16kHz
    const downsampled = this.downsample(channelData, sampleRate, this.targetRate);

    // 追加到缓冲区
    const newBuffer = new Float32Array(this.buffer.length + downsampled.length);
    newBuffer.set(this.buffer, 0);
    newBuffer.set(downsampled, this.buffer.length);
    this.buffer = newBuffer;

    // 按 frameSize 分包发送
    while (this.buffer.length >= this.frameSize) {
      const frame = this.buffer.slice(0, this.frameSize);
      this.buffer = this.buffer.slice(this.frameSize);

      const pcm16 = this.float32ToInt16(frame);
      // 传输 ArrayBuffer 给主线程
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
