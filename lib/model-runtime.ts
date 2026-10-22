import { OpenAIProvider, Runner } from "@openai/agents";

export type ModelProviderName = "openai" | "qwen";

type ModelConfiguration = {
  provider: ModelProviderName;
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string;
  label: string;
  useResponses: boolean;
};

const globalRuntime = globalThis as typeof globalThis & {
  expressionPrecisionRunner?: Runner;
};

function providerName(): ModelProviderName {
  return process.env.MODEL_PROVIDER === "qwen" ? "qwen" : "openai";
}

function serverApiKey(value: string | undefined) {
  if (process.env.VISITOR_KEY_ONLY === "true") {
    return undefined;
  }
  return value || undefined;
}

export function getModelConfiguration(): ModelConfiguration {
  const provider = providerName();

  if (provider === "qwen") {
    const model = process.env.QWEN_MODEL || "qwen-plus";
    return {
      provider,
      apiKey: serverApiKey(process.env.DASHSCOPE_API_KEY),
      baseURL:
        process.env.QWEN_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model,
      label: `${model} · Qwen`,
      useResponses: false,
    };
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  return {
    provider,
    apiKey: serverApiKey(process.env.OPENAI_API_KEY),
    baseURL: undefined,
    model,
    label: `${model} · OpenAI`,
    useResponses: true,
  };
}

export function isModelConfigured() {
  return Boolean(getModelConfiguration().apiKey);
}

function createExpressionPrecisionRunner(apiKey?: string) {
  const configuration = getModelConfiguration();
  const modelProvider = new OpenAIProvider({
    apiKey: apiKey || configuration.apiKey,
    baseURL: configuration.baseURL,
    useResponses: configuration.useResponses,
  });

  return new Runner({
    modelProvider,
    // Qwen requests should not attempt to export traces to OpenAI.
    tracingDisabled: configuration.provider !== "openai",
  });
}

export function getExpressionPrecisionRunner(apiKey?: string) {
  // A visitor-supplied key is used for this request only and must never be
  // retained in the module-level runner.
  if (apiKey) {
    return createExpressionPrecisionRunner(apiKey);
  }

  if (globalRuntime.expressionPrecisionRunner) {
    return globalRuntime.expressionPrecisionRunner;
  }

  globalRuntime.expressionPrecisionRunner = createExpressionPrecisionRunner();
  return globalRuntime.expressionPrecisionRunner;
}
