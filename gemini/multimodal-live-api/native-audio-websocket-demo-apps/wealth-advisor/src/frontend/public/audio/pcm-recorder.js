class WealthPCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.silenceSamples = 16000;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const pcm = new ArrayBuffer(channel.length * 2);
    const view = new DataView(pcm);
    let power = 0;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      power += sample * sample;
      view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    if (Math.sqrt(power / channel.length) > 0.015) this.silenceSamples = 0;
    else this.silenceSamples += channel.length;
    this.port.postMessage({ pcm, speaking: this.silenceSamples < 4800 }, [pcm]);
    return true;
  }
}
registerProcessor("wealth-pcm-recorder", WealthPCMRecorder);
