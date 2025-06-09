export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeMessage {
  type: 'user' | 'assistant' | 'summary';
  summary?: string;
  leafUuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  message?: string | MessageContent;
  uuid: string;
  timestamp: string;
  costUSD?: number | null;
  durationMs?: number | null;
  toolUseResult?: string | null;
  isMeta?: boolean | null;
  isApiErrorMessage?: boolean | null;
}

export interface MessageContent {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text: string }>;
  id?: string;
  type?: string;
  model?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: TokenUsage & {
    service_tier?: string;
    server_tool_use?: any;
  };
  ttftMs?: number;
}

export interface RateConfig {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  perTokens: number;
  currency: string;
  lastUpdated: string;
}

export interface CostBreakdown {
  inputTokensCost: number;
  outputTokensCost: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  totalCost: number;
}

export interface SessionStats {
  sessionId: string;
  totalCost: number;
  messageCount: number;
  startTime: string;
  endTime: string;
  duration: number;
  tokens: TokenUsage;
  cacheEfficiency: number;
}