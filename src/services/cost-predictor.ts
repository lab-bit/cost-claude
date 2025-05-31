import { ClaudeMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { JSONLParser } from '../core/jsonl-parser.js';

export interface UsagePattern {
  hourOfDay: number[];
  dayOfWeek: number[];
  averageCostPerSession: number;
  averageSessionsPerDay: number;
  averageTokensPerMessage: {
    input: number;
    output: number;
  };
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercentage: number;
}

export interface CostPrediction {
  nextDay: number;
  nextWeek: number;
  nextMonth: number;
  confidence: number;
  basedOnDays: number;
  pattern: UsagePattern;
}

export class CostPredictor {
  private messages: ClaudeMessage[] = [];
  private readonly minDataDays = 3; // Minimum days of data for prediction

  async loadHistoricalData(projectPath: string, days: number = 30): Promise<void> {
    try {
      const parser = new JSONLParser();
      const allMessages = await parser.parseDirectory(projectPath);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      this.messages = allMessages.filter((msg: ClaudeMessage) => 
        msg.timestamp && new Date(msg.timestamp) >= cutoffDate && msg.costUSD
      );
      
      logger.info(`Loaded ${this.messages.length} messages for prediction analysis`);
    } catch (error) {
      logger.error('Error loading historical data:', error);
      throw error;
    }
  }

  analyzeUsagePattern(): UsagePattern | null {
    if (this.messages.length === 0) {
      logger.warn('No messages available for pattern analysis');
      return null;
    }

    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    const hourCosts = new Array(24).fill(0);
    const dayCosts = new Array(7).fill(0);
    
    const sessionCosts = new Map<string, number>();
    const dailySessions = new Map<string, Set<string>>();
    
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let tokenMessageCount = 0;

    // Analyze each message
    this.messages.forEach(msg => {
      if (!msg.timestamp || !msg.costUSD) return;
      
      const date = new Date(msg.timestamp);
      const hour = date.getHours();
      const day = date.getDay();
      const dateStr = date.toDateString();
      
      hourCounts[hour]++;
      dayCounts[day]++;
      hourCosts[hour] += msg.costUSD;
      dayCosts[day] += msg.costUSD;
      
      // Track sessions
      if (msg.sessionId) {
        sessionCosts.set(msg.sessionId, (sessionCosts.get(msg.sessionId) || 0) + msg.costUSD);
        
        if (!dailySessions.has(dateStr)) {
          dailySessions.set(dateStr, new Set());
        }
        dailySessions.get(dateStr)!.add(msg.sessionId);
      }
      
      // Extract token usage
      if (msg.message && typeof msg.message === 'object' && msg.message.usage) {
        totalInputTokens += msg.message.usage.input_tokens || 0;
        totalOutputTokens += msg.message.usage.output_tokens || 0;
        tokenMessageCount++;
      }
    });

    // Calculate averages
    const totalDays = dailySessions.size || 1;
    const totalSessions = sessionCosts.size || 1;
    
    const averageCostPerSession = Array.from(sessionCosts.values())
      .reduce((sum, cost) => sum + cost, 0) / totalSessions;
    
    const averageSessionsPerDay = Array.from(dailySessions.values())
      .reduce((sum, sessions) => sum + sessions.size, 0) / totalDays;

    // Calculate trend
    const trend = this.calculateTrend();

    return {
      hourOfDay: hourCosts.map((cost, hour) => 
        hourCounts[hour] > 0 ? cost / hourCounts[hour] : 0
      ),
      dayOfWeek: dayCosts.map((cost, day) => 
        dayCounts[day] > 0 ? cost / dayCounts[day] : 0
      ),
      averageCostPerSession,
      averageSessionsPerDay,
      averageTokensPerMessage: {
        input: tokenMessageCount > 0 ? totalInputTokens / tokenMessageCount : 0,
        output: tokenMessageCount > 0 ? totalOutputTokens / tokenMessageCount : 0
      },
      trend: trend.direction,
      trendPercentage: trend.percentage
    };
  }

  private calculateTrend(): { direction: 'increasing' | 'decreasing' | 'stable'; percentage: number } {
    if (this.messages.length < this.minDataDays * 10) {
      return { direction: 'stable', percentage: 0 };
    }

    // Group costs by day
    const dailyCosts = new Map<string, number>();
    this.messages.forEach(msg => {
      if (!msg.timestamp || !msg.costUSD) return;
      const dateStr = new Date(msg.timestamp).toDateString();
      dailyCosts.set(dateStr, (dailyCosts.get(dateStr) || 0) + msg.costUSD);
    });

    const sortedDays = Array.from(dailyCosts.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

    if (sortedDays.length < 2) {
      return { direction: 'stable', percentage: 0 };
    }

    // Simple linear regression
    const n = sortedDays.length;
    const halfN = Math.floor(n / 2);
    
    const firstHalfAvg = sortedDays.slice(0, halfN)
      .reduce((sum, [_, cost]) => sum + cost, 0) / halfN;
    
    const secondHalfAvg = sortedDays.slice(halfN)
      .reduce((sum, [_, cost]) => sum + cost, 0) / (n - halfN);

    const changePercent = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    if (Math.abs(changePercent) < 5) {
      return { direction: 'stable', percentage: 0 };
    } else if (changePercent > 0) {
      return { direction: 'increasing', percentage: changePercent };
    } else {
      return { direction: 'decreasing', percentage: Math.abs(changePercent) };
    }
  }

  predict(): CostPrediction | null {
    const pattern = this.analyzeUsagePattern();
    if (!pattern) {
      return null;
    }

    // Get unique days in the data
    const uniqueDays = new Set(
      this.messages
        .filter(msg => msg.timestamp)
        .map(msg => new Date(msg.timestamp).toDateString())
    );

    const daysOfData = uniqueDays.size;
    
    if (daysOfData < this.minDataDays) {
      logger.warn(`Insufficient data for prediction. Need at least ${this.minDataDays} days, have ${daysOfData}`);
      return null;
    }

    // Calculate base daily cost
    const totalCost = this.messages.reduce((sum, msg) => sum + (msg.costUSD || 0), 0);
    const avgDailyCost = totalCost / daysOfData;

    // Apply trend adjustment
    let trendMultiplier = 1;
    if (pattern.trend === 'increasing') {
      trendMultiplier = 1 + (pattern.trendPercentage / 100) * 0.1; // 10% of trend
    } else if (pattern.trend === 'decreasing') {
      trendMultiplier = 1 - (pattern.trendPercentage / 100) * 0.1;
    }

    // Make predictions
    const nextDay = avgDailyCost * trendMultiplier;
    const nextWeek = nextDay * 7;
    const nextMonth = nextDay * 30;

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(daysOfData, pattern);

    return {
      nextDay,
      nextWeek,
      nextMonth,
      confidence,
      basedOnDays: daysOfData,
      pattern
    };
  }

  private calculateConfidence(daysOfData: number, pattern: UsagePattern): number {
    let confidence = 0;

    // More data = higher confidence
    if (daysOfData >= 30) confidence += 40;
    else if (daysOfData >= 14) confidence += 30;
    else if (daysOfData >= 7) confidence += 20;
    else confidence += 10;

    // Stable pattern = higher confidence
    if (pattern.trend === 'stable') confidence += 30;
    else if (pattern.trendPercentage < 20) confidence += 20;
    else if (pattern.trendPercentage < 50) confidence += 10;

    // Regular usage pattern = higher confidence
    const variance = this.calculateVariance();
    if (variance < 0.2) confidence += 30;
    else if (variance < 0.5) confidence += 20;
    else if (variance < 1.0) confidence += 10;

    return Math.min(confidence, 95); // Cap at 95%
  }

  private calculateVariance(): number {
    const dailyCosts = new Map<string, number>();
    this.messages.forEach(msg => {
      if (!msg.timestamp || !msg.costUSD) return;
      const dateStr = new Date(msg.timestamp).toDateString();
      dailyCosts.set(dateStr, (dailyCosts.get(dateStr) || 0) + msg.costUSD);
    });

    const costs = Array.from(dailyCosts.values());
    if (costs.length === 0) return 1;

    const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    const variance = costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) / costs.length;
    
    return variance / (mean * mean); // Coefficient of variation squared
  }

  generateInsights(prediction: CostPrediction): string[] {
    const insights: string[] = [];
    
    // Cost trend insight
    if (prediction.pattern.trend === 'increasing') {
      insights.push(`📈 Your usage is trending up by ${prediction.pattern.trendPercentage.toFixed(1)}%`);
    } else if (prediction.pattern.trend === 'decreasing') {
      insights.push(`📉 Your usage is trending down by ${prediction.pattern.trendPercentage.toFixed(1)}%`);
    } else {
      insights.push('📊 Your usage pattern is stable');
    }

    // Peak usage times
    const peakHour = prediction.pattern.hourOfDay.indexOf(Math.max(...prediction.pattern.hourOfDay));
    const peakDay = prediction.pattern.dayOfWeek.indexOf(Math.max(...prediction.pattern.dayOfWeek));
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    insights.push(`🕐 Peak usage: ${peakHour}:00-${peakHour + 1}:00 on ${days[peakDay]}s`);

    // Session insights
    insights.push(`💬 Average ${prediction.pattern.averageSessionsPerDay.toFixed(1)} sessions/day at $${prediction.pattern.averageCostPerSession.toFixed(2)}/session`);

    // Confidence level
    if (prediction.confidence >= 80) {
      insights.push(`✅ High confidence prediction (${prediction.confidence}%)`);
    } else if (prediction.confidence >= 60) {
      insights.push(`⚠️ Moderate confidence prediction (${prediction.confidence}%)`);
    } else {
      insights.push(`❓ Low confidence prediction (${prediction.confidence}%) - need more data`);
    }

    // Cost optimization suggestions
    if (prediction.pattern.averageTokensPerMessage.output > prediction.pattern.averageTokensPerMessage.input * 2) {
      insights.push('💡 Consider using more concise prompts to reduce output tokens');
    }

    return insights;
  }

  formatPrediction(prediction: CostPrediction): string {
    const lines: string[] = [
      '🔮 Cost Prediction Report',
      '=' .repeat(40),
      '',
      '📊 Predicted Costs:',
      `  Tomorrow: $${prediction.nextDay.toFixed(2)}`,
      `  Next Week: $${prediction.nextWeek.toFixed(2)}`,
      `  Next Month: $${prediction.nextMonth.toFixed(2)}`,
      '',
      `📈 Based on ${prediction.basedOnDays} days of data`,
      `🎯 Confidence: ${prediction.confidence}%`,
      '',
      '💡 Insights:',
      ...this.generateInsights(prediction).map(insight => `  ${insight}`)
    ];

    return lines.join('\n');
  }
}