import { ClaudeMessage } from '../types/index.js';
import { JSONLParser } from '../core/jsonl-parser.js';
import { CostCalculator } from '../core/cost-calculator.js';
import { ProjectParser } from '../core/project-parser.js';
import { formatDate } from '../utils/format.js';

export interface GroupedStats {
  groupName: string;
  totalCost: number;
  messageCount: number;
  avgCost: number;
  duration: number;
  tokens: {
    input: number;
    output: number;
    cache: number;
    cacheWrite: number;
  };
  cacheEfficiency: number;
  costBreakdown?: {
    inputCost: number;
    outputCost: number;
    cacheWriteCost: number;
    cacheReadCost: number;
  };
  startTime?: string;
  endTime?: string;
  projectName?: string; // For session grouping
  dateRange?: string; // For session grouping
}

export class GroupAnalyzer {
  constructor(
    private parser: JSONLParser,
    private calculator: CostCalculator,
  ) {}

  /**
   * Group by project
   */
  groupByProject(messages: ClaudeMessage[]): GroupedStats[] {
    const grouped = ProjectParser.groupByProject(messages);
    const results: GroupedStats[] = [];

    grouped.forEach((projectMessages, projectName) => {
      const stats = this.calculateGroupStats(projectMessages, projectName);
      if (stats.messageCount > 0) {
        results.push(stats);
      }
    });

    return results.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Group by date
   */
  groupByDate(messages: ClaudeMessage[]): GroupedStats[] {
    const grouped = new Map<string, ClaudeMessage[]>();

    messages.forEach(msg => {
      if (!msg.timestamp) return; // Skip messages without timestamp
      
      const timestamp = new Date(msg.timestamp);
      if (isNaN(timestamp.getTime())) return; // Skip invalid dates
      
      const date = formatDate(timestamp);
      if (date === 'Invalid Date') return; // Skip if formatDate returns invalid
      
      if (!grouped.has(date)) {
        grouped.set(date, []);
      }
      grouped.get(date)!.push(msg);
    });

    const results: GroupedStats[] = [];
    grouped.forEach((dateMessages, date) => {
      const stats = this.calculateGroupStats(dateMessages, date);
      if (stats.messageCount > 0) {
        results.push(stats);
      }
    });

    return results.sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  /**
   * Group by hour (date + hour)
   */
  groupByHour(messages: ClaudeMessage[]): GroupedStats[] {
    const grouped = new Map<string, ClaudeMessage[]>();

    messages.forEach(msg => {
      if (!msg.timestamp) return; // Skip messages without timestamp
      
      const timestamp = new Date(msg.timestamp);
      if (isNaN(timestamp.getTime())) return; // Skip invalid dates
      
      const date = formatDate(timestamp);
      if (date === 'Invalid Date') return; // Skip if formatDate returns invalid
      
      const hourKey = `${date} ${timestamp.getHours().toString().padStart(2, '0')}:00`;
      
      if (!grouped.has(hourKey)) {
        grouped.set(hourKey, []);
      }
      grouped.get(hourKey)!.push(msg);
    });

    const results: GroupedStats[] = [];
    grouped.forEach((hourMessages, hour) => {
      const stats = this.calculateGroupStats(hourMessages, hour);
      if (stats.messageCount > 0) {
        results.push(stats);
      }
    });

    return results.sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  /**
   * Group by session (existing functionality)
   */
  groupBySession(messages: ClaudeMessage[], filterLastWeek: boolean = false): GroupedStats[] {
    const grouped = this.parser.groupBySession(messages);
    const results: GroupedStats[] = [];

    grouped.forEach((sessionMessages, sessionId) => {
      const stats = this.calculateGroupStats(sessionMessages, sessionId);
      if (stats.messageCount > 0) {
        // Add project name and date range for sessions
        if (sessionMessages.length > 0) {
          // Get project name from first message
          const firstMessage = sessionMessages[0];
          if (firstMessage) {
            stats.projectName = ProjectParser.getProjectFromMessage(firstMessage);
          }
          
          // Format date range
          if (stats.startTime && stats.endTime) {
            const start = new Date(stats.startTime);
            const end = new Date(stats.endTime);
            
            if (formatDate(start) === formatDate(end)) {
              // Same day
              stats.dateRange = formatDate(start);
            } else {
              // Different days - use shorter format
              const startMonth = start.getMonth() + 1;
              const startDay = start.getDate();
              const endMonth = end.getMonth() + 1;
              const endDay = end.getDate();
              
              if (start.getFullYear() === end.getFullYear() && startMonth === endMonth) {
                // Same year and month
                stats.dateRange = `${start.getFullYear()}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}~${String(endDay).padStart(2, '0')}`;
              } else {
                // Different months or years
                stats.dateRange = `${String(startMonth).padStart(2, '0')}/${String(startDay).padStart(2, '0')}~${String(endMonth).padStart(2, '0')}/${String(endDay).padStart(2, '0')}`;
              }
            }
          }
        }
        
        // Filter by last week if requested
        if (filterLastWeek && stats.endTime) {
          const endDate = new Date(stats.endTime);
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          oneWeekAgo.setHours(0, 0, 0, 0);
          
          // Skip sessions that ended more than a week ago
          if (endDate < oneWeekAgo) {
            return;
          }
        }
        
        results.push(stats);
      }
    });

    return results.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Calculate statistics for a group of messages
   */
  private calculateGroupStats(messages: ClaudeMessage[], groupName: string): GroupedStats {
    const assistantMessages = this.parser.filterByType(messages, 'assistant');
    
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheTokens = 0;
    let totalDuration = 0;

    let totalCacheCreationTokens = 0;

    // Cost breakdown accumulation
    let inputCost = 0;
    let outputCost = 0;
    let cacheWriteCost = 0;
    let cacheReadCost = 0;

    assistantMessages.forEach(msg => {
      // First try to use the pre-calculated costUSD if available and not null
      if (msg.costUSD !== null && msg.costUSD !== undefined) {
        totalCost += msg.costUSD;
      } else {
        // Fallback: calculate cost from token usage
        const content = this.parser.parseMessageContent(msg);
        if (content?.usage) {
          totalCost += this.calculator.calculate(content.usage);
        }
      }

      if (msg.durationMs) {
        totalDuration += msg.durationMs;
      }

      const content = this.parser.parseMessageContent(msg);
      if (content?.usage) {
        totalInputTokens += content.usage.input_tokens || 0;
        totalOutputTokens += content.usage.output_tokens || 0;
        totalCacheTokens += content.usage.cache_read_input_tokens || 0;
        totalCacheCreationTokens += content.usage.cache_creation_input_tokens || 0;

        // Calculate cost breakdown
        const breakdown = this.calculator.calculateBreakdown(content.usage);
        inputCost += breakdown.inputTokensCost;
        outputCost += breakdown.outputTokensCost;
        cacheWriteCost += breakdown.cacheCreationCost;
        cacheReadCost += breakdown.cacheReadCost;
      }
    });

    const cacheEfficiency = this.calculator.calculateCacheEfficiency({
      input_tokens: totalInputTokens,
      cache_read_input_tokens: totalCacheTokens,
      cache_creation_input_tokens: totalCacheCreationTokens,
    });

    const sorted = this.parser.sortByTimestamp(messages);
    const startTime = sorted.length > 0 ? sorted[0]?.timestamp : undefined;
    const endTime = sorted.length > 0 ? sorted[sorted.length - 1]?.timestamp : undefined;

    const duration = this.parser.calculateSessionDuration(messages);

    return {
      groupName,
      totalCost,
      messageCount: assistantMessages.length,
      avgCost: assistantMessages.length > 0 ? totalCost / assistantMessages.length : 0,
      duration,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        cache: totalCacheTokens,
        cacheWrite: totalCacheCreationTokens,
      },
      cacheEfficiency,
      costBreakdown: {
        inputCost,
        outputCost,
        cacheWriteCost,
        cacheReadCost,
      },
      startTime,
      endTime,
    };
  }

  /**
   * Group by model type (if multiple models are used)
   */
  groupByModel(messages: ClaudeMessage[]): GroupedStats[] {
    const grouped = new Map<string, ClaudeMessage[]>();

    messages.forEach(msg => {
      if (msg.type === 'assistant') {
        const content = this.parser.parseMessageContent(msg);
        const model = content?.model || 'unknown';
        
        if (!grouped.has(model)) {
          grouped.set(model, []);
        }
        grouped.get(model)!.push(msg);
      }
    });

    const results: GroupedStats[] = [];
    grouped.forEach((modelMessages, model) => {
      const stats = this.calculateGroupStats(modelMessages, model);
      if (stats.messageCount > 0) {
        results.push(stats);
      }
    });

    return results.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Group by cost range
   */
  groupByCostRange(messages: ClaudeMessage[]): GroupedStats[] {
    const ranges = [
      { name: 'High (>$1)', min: 1, max: Infinity },
      { name: 'Medium ($0.1-$1)', min: 0.1, max: 1 },
      { name: 'Low ($0.01-$0.1)', min: 0.01, max: 0.1 },
      { name: 'Very Low (<$0.01)', min: 0, max: 0.01 },
    ];

    const grouped = new Map<string, ClaudeMessage[]>();
    ranges.forEach(range => grouped.set(range.name, []));

    messages.forEach(msg => {
      if (msg.type === 'assistant') {
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
          const range = ranges.find(r => msgCost >= r.min && msgCost < r.max);
          if (range) {
            grouped.get(range.name)!.push(msg);
          }
        }
      }
    });

    const results: GroupedStats[] = [];
    grouped.forEach((rangeMessages, rangeName) => {
      const stats = this.calculateGroupStats(rangeMessages, rangeName);
      if (stats.messageCount > 0) {
        results.push(stats);
      }
    });

    return results;
  }
}