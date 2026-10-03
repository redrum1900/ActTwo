export function readAiFallbacks(env: NodeJS.ProcessEnv): { apiKey: string; baseUrl: string; model: string }[] {
  const configured = [];
  for (let index = 1; index <= 3; index++) {
    const prefix = `AI_FALLBACK_${index}`;
    const apiKey = env[`${prefix}_API_KEY`]?.trim() ?? '';
    const baseUrl = env[`${prefix}_BASE_URL`]?.trim() ?? '';
    const model = env[`${prefix}_MODEL`]?.trim() ?? '';
    if (!apiKey && !baseUrl && !model) continue;
    if (!apiKey || !baseUrl || !model) throw new Error(`${prefix} 需要同时配置 API_KEY、BASE_URL 和 MODEL`);
    if (!/^https:\/\//.test(baseUrl)) throw new Error(`${prefix}_BASE_URL 必须是 HTTPS 地址`);
    configured.push({ apiKey, baseUrl, model });
  }
  return configured;
}
