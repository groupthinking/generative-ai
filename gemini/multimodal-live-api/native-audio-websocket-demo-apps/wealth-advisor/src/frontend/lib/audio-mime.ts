// Bare PCM retains the backend's default rate; explicit rates must match the player.
export function acceptsPcmAudio(mimeType: unknown, sampleRate: number): boolean {
  if (typeof mimeType !== "string") return false;
  const [type, ...parameters] = mimeType.split(";");
  if (type.trim().toLowerCase() !== "audio/pcm") return false;
  let hasRate = false;
  for (const parameter of parameters) {
    if (parameter.split("=", 1)[0].trim().toLowerCase() !== "rate") continue;
    if (hasRate) return false;
    hasRate = true;
    const rate = /^\s*rate\s*=\s*(?:"([0-9]+)"|([0-9]+))\s*$/i.exec(parameter);
    if (!rate || Number(rate[1] ?? rate[2]) !== sampleRate) return false;
  }
  return true;
}
