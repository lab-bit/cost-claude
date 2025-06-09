import { createServer } from 'http';
import { ClaudeMessage } from '../../types/index.js';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { logger } from '../../utils/logger.js';
import { JSONLParser } from '../../core/jsonl-parser.js';
import { CostCalculator } from '../../core/cost-calculator.js';
import { GroupAnalyzer } from '../../analytics/group-analyzer.js';
import { CostPredictor } from '../../services/cost-predictor.js';
import { UsageInsightsAnalyzer } from '../../services/usage-insights.js';

/**
 * Get the cost of a message, calculating from tokens if costUSD is null
 */
function getMessageCost(message: ClaudeMessage, parser: JSONLParser, calculator: CostCalculator): number {
  // First try to use the pre-calculated costUSD if available and not null
  if (message.costUSD !== null && message.costUSD !== undefined) {
    return message.costUSD;
  }
  
  // Fallback: calculate cost from token usage
  const content = parser.parseMessageContent(message);
  if (content?.usage) {
    return calculator.calculate(content.usage);
  }
  
  return 0;
}

export interface DashboardOptions {
  path?: string;
  port?: string;
  open?: boolean;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const port = parseInt(options.port || '3000');
  const projectPath = options.path?.replace('~', process.env.HOME || '') || 
                     `${process.env.HOME}/.claude/projects`;
  
  const spinner = ora('Starting dashboard server...').start();

  try {
    // Create HTTP server
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        if (url.pathname === '/') {
          // Serve dashboard HTML
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getDashboardHTML());
        } else if (url.pathname === '/api/data') {
          // Serve analysis data
          const data = await getAnalysisData(projectPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } else if (url.pathname === '/api/refresh') {
          // Refresh data
          const data = await getAnalysisData(projectPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (error) {
        logger.error('Dashboard error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    server.listen(port, () => {
      spinner.succeed(`Dashboard running at http://localhost:${port}`);
      console.log(chalk.dim('Press Ctrl+C to stop'));
      
      if (options.open !== false) {
        open(`http://localhost:${port}`);
      }
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\nShutting down dashboard...'));
      server.close();
      process.exit(0);
    });

  } catch (error) {
    spinner.fail('Failed to start dashboard');
    logger.error('Dashboard error:', error);
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function getAnalysisData(projectPath: string) {
  const parser = new JSONLParser();
  const calculator = new CostCalculator();
  const groupAnalyzer = new GroupAnalyzer(parser, calculator);
  const predictor = new CostPredictor();
  const insightsAnalyzer = new UsageInsightsAnalyzer();

  await calculator.ensureRatesLoaded();

  // Load messages
  const messages = await parser.parseDirectory(projectPath);
  
  // Calculate basic stats
  const totalCost = messages.reduce((sum: number, msg: ClaudeMessage) => {
    if (msg.type === 'assistant') {
      return sum + getMessageCost(msg, parser, calculator);
    }
    return sum;
  }, 0);
  const messageCount = messages.length;
  
  // Group by date for chart
  const byDate = groupAnalyzer.groupByDate(messages);
  const dailyData = byDate.map(group => ({
    date: group.groupName,
    cost: group.totalCost,
    messages: group.messageCount
  }));

  // Group by session for top sessions
  const bySessions = groupAnalyzer.groupBySession(messages);
  const topSessions = bySessions
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10)
    .map(session => ({
      id: session.groupName.substring(0, 8) + '...',
      cost: session.totalCost,
      messages: session.messageCount,
      duration: session.duration,
      efficiency: session.cacheEfficiency
    }));

  
  // Get predictions
  await predictor.loadHistoricalData(projectPath, 30);
  const predictions = predictor.predict();
  
  // Get insights
  const insights = await insightsAnalyzer.analyzeUsage(messages);
  const topInsights = insights.slice(0, 5);

  return {
    overview: {
      totalCost,
      messageCount,
      sessionCount: bySessions.length,
      avgCostPerMessage: messageCount > 0 ? totalCost / messageCount : 0,
      lastUpdated: new Date().toISOString()
    },
    dailyData,
    topSessions,
    predictions,
    insights: topInsights,
    recentMessages: messages
      .filter((msg: ClaudeMessage) => msg.type === 'assistant')
      .map((msg: ClaudeMessage) => ({
        timestamp: msg.timestamp,
        cost: getMessageCost(msg, parser, calculator),
        sessionId: msg.sessionId?.substring(0, 8) + '...',
        type: msg.type
      }))
      .filter(msg => msg.cost > 0)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)
  };
}

function getDashboardHTML(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Cost Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-card: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --accent: #3b82f6;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background: var(--bg-secondary);
            border-radius: 12px;
        }
        
        .header h1 {
            font-size: 2rem;
            color: var(--accent);
        }
        
        .refresh-btn {
            background: var(--accent);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            transition: opacity 0.2s;
        }
        
        .refresh-btn:hover {
            opacity: 0.9;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: var(--bg-secondary);
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .metric-card {
            text-align: center;
        }
        
        .metric-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        
        .metric-value {
            font-size: 2rem;
            font-weight: bold;
            color: var(--accent);
        }
        
        .chart-container {
            position: relative;
            height: 300px;
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 1.5rem;
            margin-bottom: 20px;
            color: var(--text-primary);
        }
        
        .table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .table th,
        .table td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid var(--bg-card);
        }
        
        .table th {
            color: var(--text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.875rem;
        }
        
        .insight {
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            border-left: 4px solid;
        }
        
        .insight.critical {
            background: rgba(239, 68, 68, 0.1);
            border-color: var(--danger);
        }
        
        .insight.warning {
            background: rgba(245, 158, 11, 0.1);
            border-color: var(--warning);
        }
        
        .insight.info {
            background: rgba(59, 130, 246, 0.1);
            border-color: var(--accent);
        }
        
        .insight.success {
            background: rgba(16, 185, 129, 0.1);
            border-color: var(--success);
        }
        
        .budget-bar {
            width: 100%;
            height: 20px;
            background: var(--bg-card);
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        
        .budget-fill {
            height: 100%;
            background: var(--accent);
            transition: width 0.3s ease;
        }
        
        .budget-fill.warning {
            background: var(--warning);
        }
        
        .budget-fill.danger {
            background: var(--danger);
        }
        
        .loading {
            display: none;
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
        }
        
        .error {
            display: none;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid var(--danger);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            color: var(--danger);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Claude Cost Dashboard</h1>
            <button class="refresh-btn" onclick="refreshData()">🔄 Refresh</button>
        </div>
        
        <div class="loading">Loading data...</div>
        <div class="error"></div>
        
        <div id="dashboard" style="display: none;">
            <!-- Metrics Grid -->
            <div class="grid" id="metrics"></div>
            
            <!-- Daily Cost Chart -->
            <div class="card">
                <h2 class="section-title">Daily Cost Trend</h2>
                <div class="chart-container">
                    <canvas id="dailyChart"></canvas>
                </div>
            </div>
            
            
            <!-- Insights -->
            <div class="card">
                <h2 class="section-title">Usage Insights</h2>
                <div id="insights"></div>
            </div>
            
            <!-- Top Sessions -->
            <div class="card">
                <h2 class="section-title">Top Sessions</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Session</th>
                            <th>Cost</th>
                            <th>Messages</th>
                            <th>Cache</th>
                        </tr>
                    </thead>
                    <tbody id="sessionsTable"></tbody>
                </table>
            </div>
        </div>
    </div>
    
    <script>
        let chart = null;
        
        async function loadData() {
            const loading = document.querySelector('.loading');
            const error = document.querySelector('.error');
            const dashboard = document.getElementById('dashboard');
            
            loading.style.display = 'block';
            error.style.display = 'none';
            dashboard.style.display = 'none';
            
            try {
                const response = await fetch('/api/data');
                if (!response.ok) throw new Error('Failed to load data');
                
                const data = await response.json();
                updateDashboard(data);
                
                loading.style.display = 'none';
                dashboard.style.display = 'block';
            } catch (err) {
                loading.style.display = 'none';
                error.style.display = 'block';
                error.textContent = 'Error loading data: ' + err.message;
            }
        }
        
        function updateDashboard(data) {
            // Update metrics
            const metricsHtml = [
                { label: 'Total Cost', value: '$' + data.overview.totalCost.toFixed(2) },
                { label: 'Total Messages', value: data.overview.messageCount.toLocaleString() },
                { label: 'Sessions', value: data.overview.sessionCount },
                { label: 'Avg Cost/Message', value: '$' + data.overview.avgCostPerMessage.toFixed(4) }
            ].map(metric => \`
                <div class="card metric-card">
                    <div class="metric-label">\${metric.label}</div>
                    <div class="metric-value">\${metric.value}</div>
                </div>
            \`).join('');
            
            document.getElementById('metrics').innerHTML = metricsHtml;
            
            // Update chart
            updateChart(data.dailyData);
            
            // Update budget status
            updateBudgetStatus(data.budgetStatus);
            
            // Update insights
            updateInsights(data.insights);
            
            // Update sessions table
            updateSessionsTable(data.topSessions);
        }
        
        function updateChart(dailyData) {
            const ctx = document.getElementById('dailyChart').getContext('2d');
            
            if (chart) {
                chart.destroy();
            }
            
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dailyData.map(d => d.date),
                    datasets: [{
                        label: 'Daily Cost ($)',
                        data: dailyData.map(d => d.cost),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f1f5f9'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: '#94a3b8'
                            },
                            grid: {
                                color: '#334155'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: '#94a3b8',
                                callback: function(value) {
                                    return '$' + value.toFixed(2);
                                }
                            },
                            grid: {
                                color: '#334155'
                            }
                        }
                    }
                }
            });
        }
        
        
        function updateInsights(insights) {
            if (!insights || insights.length === 0) {
                document.getElementById('insights').innerHTML = '<p style="color: var(--text-secondary)">No insights available</p>';
                return;
            }
            
            const html = insights.map(insight => \`
                <div class="insight \${insight.severity}">
                    <strong>\${insight.title}</strong><br>
                    \${insight.description}
                    \${insight.recommendation ? \`<br><em style="color: var(--text-secondary)">\${insight.recommendation}</em>\` : ''}
                </div>
            \`).join('');
            
            document.getElementById('insights').innerHTML = html;
        }
        
        function updateSessionsTable(sessions) {
            const html = sessions.map(session => \`
                <tr>
                    <td>\${session.id}</td>
                    <td>$\${session.cost.toFixed(2)}</td>
                    <td>\${session.messages}</td>
                    <td>\${session.efficiency.toFixed(1)}%</td>
                </tr>
            \`).join('');
            
            document.getElementById('sessionsTable').innerHTML = html;
        }
        
        function refreshData() {
            loadData();
        }
        
        // Load data on page load
        loadData();
        
        // Auto-refresh every 30 seconds
        setInterval(loadData, 30000);
    </script>
</body>
</html>
`;
}