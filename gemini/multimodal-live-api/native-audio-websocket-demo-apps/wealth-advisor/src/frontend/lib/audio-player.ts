export async function startAudioPlayerWorklet(context: AudioContext): Promise<[AudioWorkletNode, AudioContext]> {
  if (context.sampleRate !== 24000) throw new Error("Audio playback requires a 24 kHz AudioContext");
  await context.audioWorklet.addModule("/audio/pcm-player.js");
  const node = new AudioWorkletNode(context, "wealth-pcm-player", { outputChannelCount: [1] });
  node.connect(context.destination);
  return [node, context];
}
