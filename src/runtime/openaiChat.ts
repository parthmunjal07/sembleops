// Fast JSON chat call for latency-critical routing (Marco's front door).
// Local workers may use authenticated CLIs; API-backed routing remains an
// operator-funded server-side integration.

import { configuredModels, openAiApiKey, openAiApiKeyAvailable } from "./openaiConfig.js";

const DEFAULT_MODELS = [
  "gpt-5-mini",
  "gpt-4o-mini",
  "gpt-4.1-mini",
] as const;

export interface ChatResult {
  ok: boolean;
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export function chatKeyAvailable(): boolean {
  return openAiApiKeyAvailable();
}

export async function chatJson(prompt: string, timeoutMs = 25_000): Promise<ChatResult> {
  return chat(prompt, { json: true, timeoutMs, minimalReasoning: true });
}

/** Plain-text completion for cloud worker runs (drafts, research, verification). */
export async function chatText(
  prompt: string,
  timeoutMs = 120_000,
  maxCompletionTokens?: number,
): Promise<ChatResult> {
  const opts: { json: boolean; timeoutMs: number; minimalReasoning: boolean; maxCompletionTokens?: number } = {
    json: false,
    timeoutMs,
    minimalReasoning: true,
  };
  if (maxCompletionTokens !== undefined) opts.maxCompletionTokens = maxCompletionTokens;
  return chat(prompt, opts);
}

async function chat(
  prompt: string,
  opts: { json: boolean; timeoutMs: number; minimalReasoning: boolean; maxCompletionTokens?: number },
): Promise<ChatResult> {
  const key = openAiApiKey();
  if (!key) return { ok: false, text: "", error: "no OpenAI API key configured" };

  let lastError = "";
  for (const model of configuredModels("SEMBLEOPS_OPENAI_CHAT_MODELS", DEFAULT_MODELS)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          ...(opts.json && { response_format: { type: "json_object" } }),
          // Routing is classification, not problem-solving: skip deep reasoning.
          ...(opts.minimalReasoning && model.startsWith("gpt-5") && { reasoning_effort: "minimal" }),
          // Reasoning models spend thinking tokens from the same budget, so a
          // tight cap yields an EMPTY completion. The cap here is runaway
          // protection only; the real length target travels in the prompt.
          ...(opts.maxCompletionTokens &&
            (model.startsWith("gpt-5")
              ? { max_completion_tokens: opts.maxCompletionTokens + 1500 }
              : { max_tokens: opts.maxCompletionTokens })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `${model}: ${res.status} ${(await res.text()).slice(0, 200)}`;
        continue; // model not available on this account — try the next
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (text.trim().length === 0) {
        // Never report an empty completion as success (a length-capped
        // reasoning model does exactly this) — fall through to the next model.
        lastError = `${model}: empty completion (finish_reason ${data.choices?.[0]?.finish_reason ?? "unknown"})`;
        continue;
      }
      return {
        ok: true,
        text,
        model,
        ...(data.usage?.prompt_tokens !== undefined && { inputTokens: data.usage.prompt_tokens }),
        ...(data.usage?.completion_tokens !== undefined && { outputTokens: data.usage.completion_tokens }),
      };
    } catch (err) {
      lastError = `${model}: ${(err as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, text: "", error: lastError };
}
