/**
 * OpenAI-compatible request / response shapes (the subset we care about).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; image_url?: unknown }> | null;
  name?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  user?: string;
  seed?: number;
  stream_options?: { include_usage?: boolean };
  logprobs?: boolean;
  top_logprobs?: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: unknown;
      reasoning_content?: string | null;
    };
    finish_reason: string | null;
    logprobs?: unknown;
  }[];
  usage?: Usage;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: unknown;
      reasoning_content?: string | null;
    };
    finish_reason: string | null;
  }[];
  usage?: Usage;
}

export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | number | null;
  };
}

/** The shape /v1/models returns. */
export interface ModelListResponse {
  object: "list";
  data: {
    id: string;
    object: "model";
    created: number;
    owned_by: string;
    context_length?: number;
    pricing?: { input: string; output: string };
  }[];
}
