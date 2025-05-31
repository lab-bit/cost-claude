import { ClaudeMessage } from '../types/index.js';
import { CostCalculator } from '../core/cost-calculator.js';
import chalk from 'chalk';

export interface UsageInsight {
  type: 'optimization' | 'pattern' | 'anomaly' | 'achievement';
  severity: 'info' | 'warning' | 'critical' | 'success';
  title: string;
  description: string;
  impact?: number; // Potential cost savings
  recommendation?: string;
}

export interface SessionEfficiency {
  sessionId: string;
  efficiency: number; // 0-100
  totalCost: number;
  messageCount: number;
  avgCostPerMessage: number;
  cacheHitRate: number;
  factors: string[];
}

export interface ModelComparison {
  currentModel: string;
  suggestedModel?: string;
  potentialSavings?: number;
  reason?: string;
}

export class UsageInsightsAnalyzer {
  private calculator: CostCalculator;

  constructor() {
    this.calculator = new CostCalculator();
  }

  async analyzeUsage(messages: ClaudeMessage[]): Promise<UsageInsight[]> {
    const insights: UsageInsight[] = [];

    // Analyze various aspects
    insights.push(...this.analyzeTokenUsage(messages));
    insights.push(...this.analyzeCacheUsage(messages));
    insights.push(...this.analyzeSessionPatterns(messages));
    insights.push(...this.analyzeTimePatterns(messages));
    insights.push(...this.analyzeCostAnomalies(messages));
    insights.push(...this.analyzeModelUsage(messages));

    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2, success: 3 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return insights;
  }

  private analyzeTokenUsage(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    // Calculate average tokens per message
    let totalInput = 0;
    let totalOutput = 0;
    let messageCount = 0;

    messages.forEach(msg => {
      if (msg.message && typeof msg.message === 'object' && msg.message.usage) {
        totalInput += msg.message.usage.input_tokens || 0;
        totalOutput += msg.message.usage.output_tokens || 0;
        messageCount++;
      }
    });

    if (messageCount > 0) {
      const avgInput = totalInput / messageCount;
      const avgOutput = totalOutput / messageCount;
      const outputRatio = avgOutput / avgInput;

      if (outputRatio > 3) {
        insights.push({
          type: 'optimization',
          severity: 'warning',
          title: 'High output-to-input ratio',
          description: `Your responses are ${outputRatio.toFixed(1)}x longer than your prompts on average`,
          impact: totalOutput * 0.2 * (this.calculator as any).getRate('output') / 1000000, // Assume 20% reduction possible
          recommendation: 'Consider asking for more concise responses or using system prompts to limit output length'
        });
      }

      if (avgInput > 5000) {
        insights.push({
          type: 'optimization',
          severity: 'warning',
          title: 'Large average input size',
          description: `Average input is ${avgInput.toFixed(0)} tokens per message`,
          recommendation: 'Consider summarizing context or using conversation memory more efficiently'
        });
      }

      // Check for very short sessions
      const shortSessions = this.findShortSessions(messages);
      if (shortSessions.length > messages.length * 0.3) {
        insights.push({
          type: 'pattern',
          severity: 'info',
          title: 'Many short conversations',
          description: `${shortSessions.length} sessions with fewer than 3 messages`,
          recommendation: 'Consider combining related queries into single sessions for better context'
        });
      }
    }

    return insights;
  }

  private analyzeCacheUsage(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    let totalCacheHits = 0;
    let totalCacheCreation = 0;
    let totalMessages = 0;

    messages.forEach(msg => {
      if (msg.message && typeof msg.message === 'object' && msg.message.usage) {
        const usage = msg.message.usage;
        if (usage.cache_read_input_tokens > 0) totalCacheHits++;
        if (usage.cache_creation_input_tokens > 0) totalCacheCreation++;
        totalMessages++;
      }
    });

    if (totalMessages > 10) {
      const cacheHitRate = (totalCacheHits / totalMessages) * 100;
      const cacheCreationRate = (totalCacheCreation / totalMessages) * 100;

      if (cacheHitRate < 20 && totalMessages > 50) {
        insights.push({
          type: 'optimization',
          severity: 'warning',
          title: 'Low cache utilization',
          description: `Only ${cacheHitRate.toFixed(1)}% of messages use cached context`,
          impact: totalMessages * 0.001, // Rough estimate
          recommendation: 'Reuse conversations when working on the same project to benefit from context caching'
        });
      }

      if (cacheHitRate > 70) {
        insights.push({
          type: 'achievement',
          severity: 'success',
          title: 'Excellent cache usage!',
          description: `${cacheHitRate.toFixed(1)}% cache hit rate is saving you money`,
          impact: totalCacheHits * 0.002 // Rough savings estimate
        });
      }

      if (cacheCreationRate > 50) {
        insights.push({
          type: 'pattern',
          severity: 'info',
          title: 'Frequent cache creation',
          description: 'You\'re creating new cached contexts frequently',
          recommendation: 'This is normal for diverse projects, but try to reuse contexts when possible'
        });
      }
    }

    return insights;
  }

  private analyzeSessionPatterns(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    // Group by session
    const sessions = new Map<string, ClaudeMessage[]>();
    messages.forEach(msg => {
      if (msg.sessionId) {
        if (!sessions.has(msg.sessionId)) {
          sessions.set(msg.sessionId, []);
        }
        sessions.get(msg.sessionId)!.push(msg);
      }
    });

    // Analyze session efficiency
    const efficiencies: SessionEfficiency[] = [];
    
    sessions.forEach((sessionMessages) => {
      const efficiency = this.calculateSessionEfficiency(sessionMessages);
      efficiencies.push(efficiency);
    });

    // Find inefficient sessions
    const inefficientSessions = efficiencies.filter(e => e.efficiency < 50);
    if (inefficientSessions.length > 0) {
      const avgInefficiency = inefficientSessions.reduce((sum, e) => sum + e.efficiency, 0) / inefficientSessions.length;
      const totalWaste = inefficientSessions.reduce((sum, e) => sum + e.totalCost, 0) * 0.2; // Assume 20% waste
      
      insights.push({
        type: 'optimization',
        severity: 'warning',
        title: `${inefficientSessions.length} inefficient sessions detected`,
        description: `Average efficiency: ${avgInefficiency.toFixed(0)}%`,
        impact: totalWaste,
        recommendation: 'Review these sessions for repeated questions or unclear prompts'
      });
    }

    // Find highly efficient sessions
    const efficientSessions = efficiencies.filter(e => e.efficiency > 80);
    if (efficientSessions.length > 0) {
      insights.push({
        type: 'achievement',
        severity: 'success',
        title: `${efficientSessions.length} highly efficient sessions!`,
        description: 'These sessions made good use of context and caching',
        recommendation: 'Study these patterns for future sessions'
      });
    }

    return insights;
  }

  private analyzeTimePatterns(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    // Analyze usage by hour
    const hourlyUsage = new Array(24).fill(0);
    const hourlyCost = new Array(24).fill(0);
    
    messages.forEach(msg => {
      if (msg.timestamp && msg.costUSD) {
        const hour = new Date(msg.timestamp).getHours();
        hourlyUsage[hour]++;
        hourlyCost[hour] += msg.costUSD;
      }
    });

    // Find peak hours
    const peakHour = hourlyCost.indexOf(Math.max(...hourlyCost));
    const peakCost = hourlyCost[peakHour];
    const totalDailyCost = hourlyCost.reduce((sum, cost) => sum + cost, 0);
    
    if (peakCost > totalDailyCost * 0.3) {
      insights.push({
        type: 'pattern',
        severity: 'info',
        title: `Peak usage at ${peakHour}:00-${peakHour + 1}:00`,
        description: `${((peakCost / totalDailyCost) * 100).toFixed(1)}% of daily cost occurs in this hour`,
        recommendation: 'Consider spreading work throughout the day for better cost tracking'
      });
    }

    // Check for late night usage
    const lateNightUsage = hourlyUsage.slice(0, 6).reduce((sum, count) => sum + count, 0);
    const totalUsage = hourlyUsage.reduce((sum, count) => sum + count, 0);
    
    if (lateNightUsage > totalUsage * 0.3) {
      insights.push({
        type: 'pattern',
        severity: 'info',
        title: 'Significant late-night usage',
        description: `${((lateNightUsage / totalUsage) * 100).toFixed(1)}% of usage occurs between midnight and 6 AM`,
        recommendation: 'Ensure you\'re getting enough rest! Consider time management strategies'
      });
    }

    return insights;
  }

  private analyzeCostAnomalies(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    // Calculate cost statistics
    const costs = messages
      .filter(msg => msg.costUSD && msg.costUSD > 0)
      .map(msg => msg.costUSD!);
    
    if (costs.length < 10) return insights;

    const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    const stdDev = Math.sqrt(
      costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) / costs.length
    );

    // Find outliers (> 3 standard deviations)
    const outliers = messages.filter(msg => 
      msg.costUSD && msg.costUSD > mean + 3 * stdDev
    );

    if (outliers.length > 0) {
      const outlierTotal = outliers.reduce((sum, msg) => sum + (msg.costUSD || 0), 0);
      insights.push({
        type: 'anomaly',
        severity: 'warning',
        title: `${outliers.length} unusually expensive messages`,
        description: `Total cost: $${outlierTotal.toFixed(2)} (avg: $${(outlierTotal / outliers.length).toFixed(2)})`,
        recommendation: 'Review these messages for unnecessary token usage or repeated processing'
      });
    }

    // Check for cost spikes
    const dailyCosts = this.groupByDay(messages);
    const dailyValues = Array.from(dailyCosts.values());
    
    if (dailyValues.length > 7) {
      const recentAvg = dailyValues.slice(-7).reduce((sum, cost) => sum + cost, 0) / 7;
      const previousAvg = dailyValues.slice(-14, -7).reduce((sum, cost) => sum + cost, 0) / 7;
      
      if (recentAvg > previousAvg * 2) {
        insights.push({
          type: 'anomaly',
          severity: 'critical',
          title: 'Significant cost increase detected',
          description: `Recent weekly average is ${((recentAvg / previousAvg - 1) * 100).toFixed(0)}% higher`,
          impact: (recentAvg - previousAvg) * 7,
          recommendation: 'Review recent usage patterns and consider setting budget alerts'
        });
      }
    }

    return insights;
  }

  private analyzeModelUsage(messages: ClaudeMessage[]): UsageInsight[] {
    const insights: UsageInsight[] = [];
    
    // Count model usage
    const modelUsage = new Map<string, number>();
    const modelCost = new Map<string, number>();
    
    messages.forEach(msg => {
      if (msg.message && typeof msg.message === 'object' && msg.message.model) {
        const model = msg.message.model;
        modelUsage.set(model, (modelUsage.get(model) || 0) + 1);
        modelCost.set(model, (modelCost.get(model) || 0) + (msg.costUSD || 0));
      }
    });

    // Analyze if using expensive models for simple tasks
    modelUsage.forEach((count, model) => {
      const avgCost = (modelCost.get(model) || 0) / count;
      
      if (model.includes('opus') && avgCost < 0.01) {
        insights.push({
          type: 'optimization',
          severity: 'info',
          title: 'Consider using a lighter model',
          description: `You're using ${model} for tasks averaging $${avgCost.toFixed(3)}`,
          impact: count * avgCost * 0.5, // Assume 50% savings with lighter model
          recommendation: 'For simple tasks, consider using Haiku or Sonnet models'
        });
      }
    });

    return insights;
  }

  private calculateSessionEfficiency(messages: ClaudeMessage[]): SessionEfficiency {
    const sessionId = messages[0]?.sessionId || 'unknown';
    const totalCost = messages.reduce((sum, msg) => sum + (msg.costUSD || 0), 0);
    const messageCount = messages.length;
    const avgCostPerMessage = totalCost / messageCount;

    // Calculate cache hit rate
    let cacheHits = 0;
    let totalWithUsage = 0;
    
    messages.forEach(msg => {
      if (msg.message && typeof msg.message === 'object' && msg.message.usage) {
        totalWithUsage++;
        if (msg.message.usage.cache_read_input_tokens > 0) {
          cacheHits++;
        }
      }
    });

    const cacheHitRate = totalWithUsage > 0 ? (cacheHits / totalWithUsage) * 100 : 0;

    // Calculate efficiency factors
    const factors: string[] = [];
    let efficiency = 50; // Base efficiency

    // Cache usage bonus
    if (cacheHitRate > 50) {
      efficiency += 20;
      factors.push('Good cache usage');
    } else if (cacheHitRate < 10) {
      efficiency -= 10;
      factors.push('Low cache usage');
    }

    // Message count factor
    if (messageCount > 10) {
      efficiency += 10;
      factors.push('Good session length');
    } else if (messageCount < 3) {
      efficiency -= 20;
      factors.push('Very short session');
    }

    // Cost per message factor
    if (avgCostPerMessage < 0.05) {
      efficiency += 10;
      factors.push('Cost-effective messages');
    } else if (avgCostPerMessage > 0.20) {
      efficiency -= 20;
      factors.push('Expensive messages');
    }

    // Check for repeated patterns (simple heuristic)
    const messageTexts = messages
      .filter(msg => msg.message && typeof msg.message === 'object')
      .map(msg => (msg.message as any).content);
    
    const uniqueMessages = new Set(messageTexts).size;
    const repetitionRate = 1 - (uniqueMessages / messageTexts.length);
    
    if (repetitionRate > 0.2) {
      efficiency -= 15;
      factors.push('Repeated questions detected');
    }

    efficiency = Math.max(0, Math.min(100, efficiency));

    return {
      sessionId,
      efficiency,
      totalCost,
      messageCount,
      avgCostPerMessage,
      cacheHitRate,
      factors
    };
  }

  private findShortSessions(messages: ClaudeMessage[]): string[] {
    const sessionCounts = new Map<string, number>();
    
    messages.forEach(msg => {
      if (msg.sessionId) {
        sessionCounts.set(msg.sessionId, (sessionCounts.get(msg.sessionId) || 0) + 1);
      }
    });

    return Array.from(sessionCounts.entries())
      .filter(([_, count]) => count < 3)
      .map(([sessionId, _]) => sessionId);
  }

  private groupByDay(messages: ClaudeMessage[]): Map<string, number> {
    const dailyCosts = new Map<string, number>();
    
    messages.forEach(msg => {
      if (msg.timestamp && msg.costUSD) {
        const date = new Date(msg.timestamp).toDateString();
        dailyCosts.set(date, (dailyCosts.get(date) || 0) + msg.costUSD);
      }
    });

    return dailyCosts;
  }

  formatInsights(insights: UsageInsight[]): string {
    if (insights.length === 0) {
      return chalk.green('✨ No significant insights found. Your usage looks good!');
    }

    const lines: string[] = [
      chalk.bold('📊 Usage Insights Report'),
      '=' .repeat(50),
      ''
    ];

    const iconMap = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️',
      success: '✅'
    };

    const colorMap = {
      critical: chalk.red,
      warning: chalk.yellow,
      info: chalk.blue,
      success: chalk.green
    };

    insights.forEach(insight => {
      const icon = iconMap[insight.severity];
      const color = colorMap[insight.severity];
      
      lines.push(color(`${icon} ${insight.title}`));
      lines.push(`   ${insight.description}`);
      
      if (insight.impact !== undefined) {
        lines.push(chalk.dim(`   💰 Potential savings: $${insight.impact.toFixed(2)}`));
      }
      
      if (insight.recommendation) {
        lines.push(chalk.dim(`   💡 ${insight.recommendation}`));
      }
      
      lines.push('');
    });

    // Summary
    const criticalCount = insights.filter(i => i.severity === 'critical').length;
    const warningCount = insights.filter(i => i.severity === 'warning').length;
    const totalSavings = insights
      .filter(i => i.impact !== undefined)
      .reduce((sum, i) => sum + (i.impact || 0), 0);

    lines.push('-'.repeat(50));
    lines.push(chalk.bold('Summary:'));
    
    if (criticalCount > 0) {
      lines.push(chalk.red(`  🚨 ${criticalCount} critical issues`));
    }
    if (warningCount > 0) {
      lines.push(chalk.yellow(`  ⚠️  ${warningCount} warnings`));
    }
    if (totalSavings > 0) {
      lines.push(chalk.green(`  💰 Potential savings: $${totalSavings.toFixed(2)}`));
    }

    return lines.join('\n');
  }
}