/** Server-side OpenAI configuration. API keys must never be sent to the UI. */
export function openAiApiKey(): string | undefined {
  return process.env["OPENAI_API_KEY"] ?? process.env["TRANSCRIPTION_API_KEY"];
}

export function openAiApiKeyAvailable(): boolean {
  return Boolean(openAiApiKey());
}

export function configuredModels(envName: string, defaults: readonly string[]): string[] {
  const configured = process.env[envName]
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured && configured.length > 0 ? [...new Set(configured)] : [...defaults];
}
