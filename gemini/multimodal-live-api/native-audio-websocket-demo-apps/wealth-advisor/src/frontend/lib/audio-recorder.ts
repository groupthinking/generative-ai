export async function startAudioRecorderWorklet(
  context: AudioContext,
  onAudio: (pcm: ArrayBuffer) => void,
  onSpeechStart: () => void,
  onSpeaking: (speaking: boolean) => void,
): Promise<[AudioWorkletNode, AudioContext, MediaStream]> {
  if (context.sampleRate !== 16000) throw new Error("Microphone capture requires a 16 kHz AudioContext");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  try {
    await context.audioWorklet.addModule("/audio/pcm-recorder.js");
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "wealth-pcm-recorder", { outputChannelCount: [1] });
    let speaking = false;
    node.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer; speaking: boolean }>) => {
      if (data.speaking !== speaking) {
        speaking = data.speaking;
        if (speaking) onSpeechStart();
        onSpeaking(speaking);
      }
      onAudio(data.pcm);
    };
    source.connect(node);
    // The worklet emits silence; this connection keeps the capture graph active.
    node.connect(context.destination);
    return [node, context, stream];
  } catch (error) {
    source?.disconnect();
    node?.disconnect();
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}
