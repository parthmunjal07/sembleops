// Voice transcription through the OpenAI audio API. Audio stays in memory;
// raw audio is never written to disk.

import { configuredModels, openAiApiKey } from "../runtime/openaiConfig.js";

const MAX_BYTES = 24 * 1024 * 1024; // API limit is 25MB
const DEFAULT_MODELS = [
  "gpt-4o-mini-transcribe",
  "whisper-1",
] as const;

export interface TranscriptionResult {
  ok: boolean;
  text: string;
  model?: string;
  error?: string;
}

export async function transcribeAudio(
  audio: Buffer,
  contentType: string,
  filename = "voice.ogg",
): Promise<TranscriptionResult> {
  const key = openAiApiKey();
  if (!key) return { ok: false, text: "", error: "OPENAI_API_KEY not set" };
  if (audio.byteLength > MAX_BYTES) {
    return { ok: false, text: "", error: "audio too large (25MB API limit)" };
  }

  let lastError = "";
  for (const model of configuredModels("SEMBLEOPS_OPENAI_TRANSCRIPTION_MODELS", DEFAULT_MODELS)) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), filename);
    form.append("model", model);
    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${(await res.text()).slice(0, 200)}`;
        continue; // e.g. model not available on this account — try the next
      }
      const data = (await res.json()) as { text?: string };
      return { ok: true, text: (data.text ?? "").trim(), model };
    } catch (err) {
      lastError = `${model}: ${(err as Error).message}`;
    }
  }
  return { ok: false, text: "", error: lastError || "transcription failed" };
}
