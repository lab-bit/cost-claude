import { ClaudeMessage } from '../types/index.js';
import { JSONLParser } from '../core/jsonl-parser.js';
import { CostCalculator } from '../core/cost-calculator.js';

export interface DailyStats {
  date: string;
  totalCost: number;
  messageCount: number;
  sessionCount: number;
  avgCostPerMessage: number;
  avgCostPerSession: number;
  peakHour: number;
  cacheEfficiency: number;
  topSessions: SessionSummary[];
}

export interface SessionSummary {
  sessionId: string;
  totalCost: number;
  messageCount: number;
  startTime: string;
  endTime: string;
  totalTokens: number;
}

export class DailyAnalyzer {
  constructor(
    private parser: JSONLParser,
    private calculator: CostCalculator,
  ) {}

  async analyze(messages: ClaudeMessage[], date?: Date): Promise<DailyStats> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0]!;

    // Filter messages for the target date
    const dayMessages = messages.filter((msg) => {
      try {
        const msgDate = new Date(msg.timestamp).toISOString().split('T')[0];
        return msgDate === dateStr;
      } catch {
        // Skip messages with invalid timestamps
        return false;
      }
    });

    // Get assistant messages only
    const assistantMessages = this.parser.filterByType(dayMessages, 'assistant');
    const sessions = this.parser.groupBySession(dayMessages);

    // Calculate basic stats
    let totalCost = 0;
    let totalCacheTokens = 0;
    let totalInputTokens = 0;
    const hourCosts: number[] = new Array(24).fill(0);

    assistantMessages.forEach((msg) => {
      let msgCost = 0;
      
      // First try to use the pre-calculated costUSD if available and not null
      if (msg.costUSD !== null && msg.costUSD !== undefined) {
        msgCost = msg.costUSD;
      } else {
        // Fallback: calculate cost from token usage
        const content = this.parser.parseMessageContent(msg);
        if (content?.usage) {
          msgCost = this.calculator.calculate(content.usage);
        }
      }
      
      if (msgCost > 0) {
        totalCost += msgCost;
        const hour = new Date(msg.timestamp).getHours();
        hourCosts[hour]! += msgCost;
      }

      const content = this.parser.parseMessageContent(msg);
      if (content?.usage) {
        totalInputTokens += content.usage.input_tokens || 0;
        totalCacheTokens += content.usage.cache_read_input_tokens || 0;
      }
    });

    // Find peak hour
    let peakHour = 0;
    let maxHourCost = 0;
    hourCosts.forEach((cost, hour) => {
      if (cost > maxHourCost) {
        maxHourCost = cost;
        peakHour = hour;
      }
    });

    // Calculate cache efficiency
    const cacheEfficiency = this.calculator.calculateCacheEfficiency({
      input_tokens: totalInputTokens,
      cache_read_input_tokens: totalCacheTokens,
    });

    // Get top sessions
    const topSessions = await this.getTopSessions(sessions);

    return {
      date: dateStr,
      totalCost,
      messageCount: assistantMessages.length,
      sessionCount: sessions.size,
      avgCostPerMessage: assistantMessages.length > 0 ? totalCost / assistantMessages.length : 0,
      avgCostPerSession: sessions.size > 0 ? totalCost / sessions.size : 0,
      peakHour,
      cacheEfficiency,
      topSessions,
    };
  }

  private async getTopSessions(
    sessions: Map<string, ClaudeMessage[]>,
  ): Promise<SessionSummary[]> {
    const sessionStats: SessionSummary[] = [];

    sessions.forEach((messages, sessionId) => {
      const sessionAssistantMessages = messages.filter((m) => m.type === 'assistant');
      if (sessionAssistantMessages.length === 0) return;

      let sessionCost = 0;
      let totalTokens = 0;

      sessionAssistantMessages.forEach((msg) => {
        // First try to use the pre-calculated costUSD if available and not null
        if (msg.costUSD !== null && msg.costUSD !== undefined) {
          sessionCost += msg.costUSD;
        } else {
          // Fallback: calculate cost from token usage
          const content = this.parser.parseMessageContent(msg);
          if (content?.usage) {
            sessionCost += this.calculator.calculate(content.usage);
          }
        }
        
        const content = this.parser.parseMessageContent(msg);
        if (content?.usage) {
          totalTokens += (content.usage.output_tokens || 0) + (content.usage.input_tokens || 0);
        }
      });

      const sorted = this.parser.sortByTimestamp(messages);
      sessionStats.push({
        sessionId,
        totalCost: sessionCost,
        messageCount: sessionAssistantMessages.length,
        startTime: sorted[0]!.timestamp,
        endTime: sorted[sorted.length - 1]!.timestamp,
        totalTokens,
      });
    });

    // Sort by cost and return top 5
    return sessionStats.sort((a, b) => b.totalCost - a.totalCost).slice(0, 5);
  }
}