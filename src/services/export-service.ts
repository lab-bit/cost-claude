import { writeFileSync } from 'fs';
import { ClaudeMessage, SessionStats } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { formatDuration, formatCurrency } from '../utils/format.js';

export type ExportFormat = 'csv' | 'json' | 'html';

export interface ExportOptions {
  format: ExportFormat;
  outputPath: string;
  title?: string;
  metadata?: Record<string, any>;
}

export interface ExportData {
  messages?: ClaudeMessage[];
  sessions?: SessionStats[];
  dailyCosts?: Map<string, number>;
  insights?: any[];
  predictions?: any;
}

export class ExportService {
  async export(data: ExportData, options: ExportOptions): Promise<void> {
    try {
      switch (options.format) {
        case 'csv':
          await this.exportCSV(data, options.outputPath);
          break;
        case 'json':
          await this.exportJSON(data, options.outputPath);
          break;
        case 'html':
          await this.exportHTML(data, options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }
      
      logger.info(`Data exported to ${options.outputPath}`);
    } catch (error) {
      logger.error('Export failed:', error);
      throw error;
    }
  }

  private async exportCSV(data: ExportData, outputPath: string): Promise<void> {
    const rows: string[] = [];
    
    if (data.sessions) {
      // Export sessions
      rows.push('Session ID,Start Time,End Time,Duration (min),Messages,Total Cost,Input Tokens,Output Tokens,Cache Efficiency');
      
      data.sessions.forEach(session => {
        rows.push([
          session.sessionId,
          session.startTime,
          session.endTime,
          (session.duration / 60000).toFixed(2),
          session.messageCount,
          session.totalCost.toFixed(4),
          session.tokens.input_tokens,
          session.tokens.output_tokens,
          session.cacheEfficiency.toFixed(2)
        ].join(','));
      });
    } else if (data.messages) {
      // Export messages
      rows.push('Timestamp,Session ID,Type,Cost,Input Tokens,Output Tokens,Cache Read,Cache Creation');
      
      data.messages.forEach(msg => {
        if (msg.message && typeof msg.message === 'object' && msg.message.usage) {
          const usage = msg.message.usage;
          rows.push([
            msg.timestamp,
            msg.sessionId || '',
            msg.type,
            (msg.costUSD || 0).toFixed(4),
            usage.input_tokens || 0,
            usage.output_tokens || 0,
            usage.cache_read_input_tokens || 0,
            usage.cache_creation_input_tokens || 0
          ].join(','));
        }
      });
    }
    
    writeFileSync(outputPath, rows.join('\n'));
  }

  private async exportJSON(data: ExportData, outputPath: string): Promise<void> {
    const exportObject: any = {
      exportDate: new Date().toISOString(),
      version: '1.0'
    };
    
    if (data.messages) exportObject.messages = data.messages;
    if (data.sessions) exportObject.sessions = data.sessions;
    if (data.dailyCosts) exportObject.dailyCosts = Object.fromEntries(data.dailyCosts);
    if (data.insights) exportObject.insights = data.insights;
    if (data.predictions) exportObject.predictions = data.predictions;
    
    writeFileSync(outputPath, JSON.stringify(exportObject, null, 2));
  }



  private async exportHTML(data: ExportData, options: ExportOptions): Promise<void> {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${options.title || 'Claude Cost Report'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: #fff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        h1 {
            margin: 0 0 10px 0;
            color: #2563eb;
        }
        .section {
            background: #fff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .metric {
            display: inline-block;
            margin: 10px 20px 10px 0;
        }
        .metric-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #2563eb;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid #e5e7eb;
        }
        th {
            background: #f9fafb;
            font-weight: 600;
        }
        .alert {
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .alert-warning {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
        }
        .alert-success {
            background: #d1fae5;
            border-left: 4px solid #10b981;
        }
        .alert-danger {
            background: #fee2e2;
            border-left: 4px solid #ef4444;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${options.title || 'Claude Cost Report'}</h1>
        <p>Generated on ${new Date().toLocaleString()}</p>
    </div>
    
    ${this.generateHTMLSummary(data)}
    ${this.generateHTMLSessions(data)}
    ${this.generateHTMLInsights(data)}
    ${this.generateHTMLCharts(data)}
</body>
</html>`;
    
    writeFileSync(options.outputPath, html);
  }

  private generateHTMLSummary(data: ExportData): string {
    if (!data.predictions) return '';
    
    let html = '<div class="section"><h2>Summary</h2><div class="metrics">';
    
    
    if (data.predictions) {
      html += `
        <div class="metric">
            <div class="metric-label">Predicted Tomorrow</div>
            <div class="metric-value">${formatCurrency(data.predictions.nextDay)}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Predicted Next Week</div>
            <div class="metric-value">${formatCurrency(data.predictions.nextWeek)}</div>
        </div>`;
    }
    
    html += '</div></div>';
    return html;
  }

  private generateHTMLSessions(data: ExportData): string {
    if (!data.sessions || data.sessions.length === 0) return '';
    
    const topSessions = data.sessions
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);
    
    let html = '<div class="section"><h2>Top Sessions</h2><table>';
    html += '<tr><th>Session ID</th><th>Duration</th><th>Messages</th><th>Cost</th><th>Cache Efficiency</th></tr>';
    
    topSessions.forEach(session => {
      html += `
        <tr>
            <td>${session.sessionId.substring(0, 8)}...</td>
            <td>${formatDuration(session.duration)}</td>
            <td>${session.messageCount}</td>
            <td>${formatCurrency(session.totalCost)}</td>
            <td>${session.cacheEfficiency.toFixed(1)}%</td>
        </tr>`;
    });
    
    html += '</table></div>';
    return html;
  }

  private generateHTMLInsights(data: ExportData): string {
    if (!data.insights || data.insights.length === 0) return '';
    
    let html = '<div class="section"><h2>Key Insights</h2>';
    
    data.insights.forEach(insight => {
      const alertClass = 
        insight.severity === 'critical' ? 'alert-danger' :
        insight.severity === 'warning' ? 'alert-warning' :
        insight.severity === 'success' ? 'alert-success' : '';
      
      html += `
        <div class="alert ${alertClass}">
            <strong>${insight.title}</strong><br>
            ${insight.description}
            ${insight.recommendation ? `<br><em>Recommendation: ${insight.recommendation}</em>` : ''}
            ${insight.impact ? `<br><small>Potential savings: ${formatCurrency(insight.impact)}</small>` : ''}
        </div>`;
    });
    
    html += '</div>';
    return html;
  }

  private generateHTMLCharts(data: ExportData): string {
    if (!data.dailyCosts || data.dailyCosts.size === 0) return '';
    
    const dailyData = Array.from(data.dailyCosts.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .slice(-30); // Last 30 days
    
    return `
<div class="section">
    <h2>Daily Cost Trend</h2>
    <canvas id="costChart" width="400" height="200"></canvas>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
        const ctx = document.getElementById('costChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(dailyData.map(d => d[0]))},
                datasets: [{
                    label: 'Daily Cost ($)',
                    data: ${JSON.stringify(dailyData.map(d => d[1]))},
                    borderColor: 'rgb(37, 99, 235)',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        }
                    }
                }
            }
        });
    </script>
</div>`;
  }
}