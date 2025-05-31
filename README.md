# Cost Claude 💰

**Real-time cost monitoring for Claude Code with desktop notifications**

[![npm version](https://badge.fury.io/js/cost-claude.svg)](https://badge.fury.io/js/cost-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cost Claude monitors and analyzes your Claude Code usage costs in real-time with desktop notifications.

## 🚀 Quick Start

### Using npx (Recommended)

```bash
# Real-time monitoring with notifications
npx cost-claude@latest watch --notify

# Quick analysis with npx
npx cost-claude@latest analyzey
```

### Global Installation

```bash
# npm
npm install -g cost-claude

# bun
bun install -g cost-claude

# After installation
cost-claude analyze
cost-claude watch --notify
```

## ✨ Features

### 🔍 Real-time Monitoring
- **Live cost tracking** with instant desktop notifications
- **3-tier notification system**: Task completion, Session completion, Cost updates
- **Intelligent task detection**: Auto-detect when Claude Code finishes responding (3s timeout)
- **macOS optimized**: Do Not Disturb mode support, notification persistence

### 💰 Cost Analytics
- **Detailed cost breakdown**: Input/Output/Cache tokens with precise cost calculation
- **Multi-dimensional analysis**: By session, project, date, or hour
- **Cache efficiency tracking**: Monitor your cache savings
- **Export capabilities**: CSV, JSON, HTML reports

## 📋 Commands

### `analyze` - Analyze Usage and Costs

```bash
# Analyze all time usage
cost-claude analyze

# Specific date range
cost-claude analyze --from 2025-05-01 --to 2025-05-31

# Group by project
cost-claude analyze --group-by project

# Export to CSV
cost-claude analyze --export report.csv --format csv
```

**Example Output:**
```
Claude Code Usage Analysis
Model: claude-opus-4-20250514
──────────────────────────────────────────────────

Overview:
  Total Messages: 1,373
  User Messages:  687
  AI Responses:   686
  Sessions:       3

Costs Summary:
  Total Cost:     $297.0732
  Avg per Msg:    $0.4330
  Cache Savings:  $1604.9583 (84.4% saved)
                  🔥 Massive savings! Without cache, total would be $1902.0315

Top 3 Sessions by Cost:
──────────────────────────────────────────────────────────────────────────────────
Session ID                    Project              Date Range      Cost     Messages
──────────────────────────────────────────────────────────────────────────────────
4d4ea244-5aba-4326-8800-c...  lab-bit/cost-claude  2025-05-26~27   $297.07      1373
65e64bb8-5088-449f-97fd-0...  lab-bit/other-repp.. 2025-05-28~30   $197.98       884
9481d24a-6c74-468e-950b-5...  lab-bit/other-repp.. 2025-05-27~28   $174.00       812
```

### `watch` - Real-time Monitoring with Notifications

```bash
# Start monitoring with notifications (default settings)
cost-claude watch --notify

# All notifications including cost updates
cost-claude watch --notify --notify-cost

# Only task completion notifications
cost-claude watch --notify --no-notify-session --no-notify-cost

# Show last 10 messages before monitoring
cost-claude watch --notify --recent 10
```

**Example Output:**
```
Claude Code Cost Watcher
Real-time monitoring for Claude usage
Model: claude-opus-4-20250514
Notifications: Task, Session
Showing last 5 messages before monitoring

Watcher initialized
Watching: /Users/you/.claude/projects
Min cost for notification: $0.0100
Press Ctrl+C to stop

[13:04:02] Cost: $0.0518 | Duration: 19.0s | Tokens: 1,062 | Cache: 100% | lab-bit/cost-claude
[13:04:08] Cost: $0.0427 | Duration: 5.9s | Tokens: 300 | Cache: 99% | lab-bit/cost-claude
[13:04:17] Cost: $0.0427 | Duration: 9.1s | Tokens: 471 | Cache: 100% | lab-bit/cost-claude
  └─ Session summary: 10 messages | Total: $0.2769 | Avg: $0.0277
```

#### Notification Types

**Default Settings:**
- ✅ **Task completion**: When Claude Code finishes responding (enabled)
- ✅ **Session completion**: When your work session ends (enabled)
- ⚪ **Cost updates**: For each message (disabled by default)

**Example Notifications:**

**Task Completion:**
```
💬 claude-code-cost-checker - Task Complete
⏱️ 5s • 💬 2 responses
💰 $0.0299
```

**Session Completion:**
```
✅ claude-code-cost-checker - Session Complete  
📝 Code refactoring completed successfully
⏱️ 45 min • 💬 23 messages
💰 Total: $0.2508
```

## 📊 Command Options

### `analyze` Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --path <path>` | Claude projects directory | `~/.claude/projects` |
| `-f, --from <date>` | Start date (YYYY-MM-DD) | - |
| `-t, --to <date>` | End date (YYYY-MM-DD) | - |
| `-g, --group-by <type>` | Group by (session/project/date/hour) | `session` |
| `--format <type>` | Output format (table/json/csv/html) | `table` |
| `--export <file>` | Export to file | - |
| `--detailed` | Show detailed cost breakdown | `false` |
| `--top <n>` | Number of results to show | `5` |

### `watch` Options

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --notify` | Enable notifications | `true` |
| `--notify-task` | Task completion notifications | `true` |
| `--notify-session` | Session completion notifications | `true` |
| `--notify-cost` | Cost update notifications | `false` |
| `--min-cost <amount>` | Minimum cost for notifications | `0.01` |
| `--sound` | Enable notification sound | `true` |
| `--recent <n>` | Show N recent messages | `5` |
| `--include-existing` | Process all existing messages | `false` |

## 🛠 Configuration

### Custom Data Directory
```bash
# Specify custom Claude projects path
cost-claude analyze --path /custom/path/to/.claude/projects
```

### Debug Mode
```bash
# Enable verbose logging
DEBUG=* cost-claude watch --notify --verbose
```

## 🔧 Troubleshooting

### macOS Notification Issues

1. **Check system settings:**
   - System Preferences > Notifications & Focus > Terminal
   - Ensure "Allow Notifications" is enabled
   - Set style to "Alerts" or "Banners"

2. **Reset notification system:**
   ```bash
   sudo killall NotificationCenter
   ```

3. **Test notifications:**
   ```bash
   npx cost-claude@latest test:mac-notification
   ```

## 📄 License

MIT © [Lab Bit](https://github.com/lab-bit)

## 🔗 Related Projects

- [Claude Code](https://claude.ai/code) - AI-powered coding assistant
