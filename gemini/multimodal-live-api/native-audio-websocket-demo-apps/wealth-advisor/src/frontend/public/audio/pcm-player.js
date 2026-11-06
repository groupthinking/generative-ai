class WealthPCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.command === "stopAudio") {
        this.queue = [];
        this.offset = 0;
      } else if (data instanceof ArrayBuffer && data.byteLength % 2 === 0) {
        this.queue.push(new DataView(data));
      }
    };
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    channel.fill(0);
    for (let i = 0; i < channel.length && this.queue.length; i++) {
      while (this.queue.length && this.offset >= this.queue[0].byteLength) {
        this.queue.shift();
        this.offset = 0;
      }
      if (!this.queue.length) break;
      channel[i] = this.queue[0].getInt16(this.offset, true) / 32768;
      this.offset += 2;
    }
    return true;
  }
}
registerProcessor("wealth-pcm-player", WealthPCMPlayer);
