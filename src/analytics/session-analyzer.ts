import { ClaudeMessage } from '../types/index.js';
import { JSONLParser } from '../core/jsonl-parser.js';
import { CostCalculator } from '../core/cost-calculator.js';

export interface SessionAnalysis {
  sessionId: string;
  duration: number;
  totalCost: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  costBreakdown: {
    inputTokensCost: number;
    outputTokensCost: number;
    cacheCreationCost: number;
    cacheReadCost: number;
  };
  efficiency: {
    cacheHitRate: number;
    avgResponseTime: number;
    costPerMinute: number;
    tokensPerMessage: number;
  };
  timeline: MessageTimeline[];
}

export interface MessageTimeline {
  timestamp: string;
  type: string;
  cost: number;
  cumulativeCost: number;
  summary: string;
}

export class SessionAnalyzer {
  constructor(
    private parser: JSONLParser,
    private calculator: CostCalculator,
  ) {}

  async analyzeSession(messages: ClaudeMessage[], sessionId: string): Promise<SessionAnalysis | null> {
    const sessionMessages = messages.filter((m) => m.sessionId === sessionId);
    if (sessionMessages.length === 0) return null;

    const sorted = this.parser.sortByTimestamp(sessionMessages);
    const userMessages = this.parser.filterByType(sessionMessages, 'user');
    const assistantMessages = this.parser.filterByType(sessionMessages, 'assistant');

    const duration = this.parser.calculateSessionDuration(sessionMessages);
    const totalCost = this.calculateTotalCost(assistantMessages);
    const costBreakdown = this.calculateCostBreakdown(assistantMessages);
    const efficiency = this.calculateEfficiency(assistantMessages, duration);
    const timeline = this.buildTimeline(sorted);

    return {
      sessionId,
      duration,
      totalCost,
      messageCount: sessionMessages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      costBreakdown,
      efficiency,
      timeline,
    };
  }

  private calculateTotalCost(messages: ClaudeMessage[]): number {
    return messages.reduce((sum, msg) => sum + (msg.costUSD || 0), 0);
  }

  private calculateCostBreakdown(messages: ClaudeMessage[]) {
    const breakdown = {
      inputTokensCost: 0,
      outputTokensCost: 0,
      cacheCreationCost: 0,
      cacheReadCost: 0,
    };

    messages.forEach((msg) => {
      const content = this.parser.parseMessageContent(msg);
      if (content?.usage) {
        const costs = this.calculator.calculateBreakdown(content.usage);
        breakdown.inputTokensCost += costs.inputTokensCost;
        breakdown.outputTokensCost += costs.outputTokensCost;
        breakdown.cacheCreationCost += costs.cacheCreationCost;
        breakdown.cacheReadCost += costs.cacheReadCost;
      }
    });

    return breakdown;
  }

  private calculateEfficiency(messages: ClaudeMessage[], duration: number) {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let cacheHits = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    messages.forEach((msg) => {
      if (msg.type === 'assistant') {
        const content = this.parser.parseMessageContent(msg);
        if (content?.usage) {
          totalInputTokens += content.usage.input_tokens || 0;
          totalOutputTokens += content.usage.output_tokens || 0;
          cacheHits += content.usage.cache_read_input_tokens || 0;
        }

        if (msg.durationMs) {
          totalResponseTime += msg.durationMs;
          responseCount++;
        }
      }
    });

    const totalCost = this.calculateTotalCost(messages);
    const totalTokens = totalInputTokens + totalOutputTokens;

    return {
      cacheHitRate: totalInputTokens > 0 ? (cacheHits / (totalInputTokens + cacheHits)) * 100 : 0,
      avgResponseTime: responseCount > 0 ? totalResponseTime / responseCount : 0,
      costPerMinute: duration > 0 ? (totalCost / duration) * 60000 : 0,
      tokensPerMessage: messages.length > 0 ? totalTokens / messages.length : 0,
    };
  }

  private buildTimeline(messages: ClaudeMessage[]): MessageTimeline[] {
    let cumulativeCost = 0;

    return messages.map((msg) => {
      if (msg.costUSD) {
        cumulativeCost += msg.costUSD;
      }

      return {
        timestamp: msg.timestamp,
        type: msg.type,
        cost: msg.costUSD || 0,
        cumulativeCost,
        summary: this.extractSummary(msg),
      };
    });
  }

  private extractSummary(message: ClaudeMessage): string {
    if (message.type === 'summary') {
      return message.summary || 'Session summary';
    }

    const content = this.parser.parseMessageContent(message);
    if (!content) return `${message.type} message`;

    if (message.type === 'user' && typeof content.content === 'string') {
      return content.content.substring(0, 100) + (content.content.length > 100 ? '...' : '');
    } else if (message.type === 'assistant') {
      return `Response (${message.durationMs || 0}ms, $${(message.costUSD || 0).toFixed(4)})`;
    }

    return `${message.type} message`;
  }
}