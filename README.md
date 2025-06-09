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
npx cost-claude@latest analyze
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

# Enable task completion notifications with custom sounds
cost-claude watch --notify --notify-task --sound --task-sound Tink --session-sound Hero

# Only session completion notifications
cost-claude watch --notify --notify-session --no-notify-task --no-notify-cost

# Show last 10 messages before monitoring
cost-claude watch --notify --recent 10
```

**Example Output:**
```
Claude Code Cost Watcher
Real-time monitoring for Claude usage
Model: claude-opus-4-20250514
Notifications: Cost, Session
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
- ⚪ **Task completion**: When Claude Code finishes responding (disabled by default)
- ✅ **Session completion**: When your work session ends (enabled)
- ✅ **Cost updates**: For each message (enabled)

#### How Detection Works

**🎯 Task Completion Detection:**
- **Immediate**: Triggered 3 seconds after Claude's last response
- **Delayed**: Triggered 30 seconds after Claude's last response (more confident)
- **What it means**: Claude has finished responding to your current question/request
- **Notification timeout**: 20 seconds (auto-disappears to avoid clutter)
- **Sound**: Pop (light, quick sound)

**✅ Session Completion Detection:**
- **Inactivity**: No messages for 5 minutes
- **Summary message**: Claude sends a session summary
- **What it means**: Your entire coding session has ended
- **Notification timeout**: Persistent (stays until manually dismissed)
- **Sound**: Glass (more substantial, satisfying sound)

**⏳ Task Progress Detection:**
- **Active monitoring**: During long-running tasks (>20 seconds, >$0.02)
- **What it means**: Claude is still working on a complex task
- **Notification timeout**: 10 seconds
- **Sound**: None (silent updates)

**Example Notifications:**

**Task Completion (20s timeout):**
```
🎯 claude-code-cost-checker - Task Complete
⏱️ 5s • 💬 2 responses
💰 $0.0299
🔊 Pop sound
```

**Session Completion (persistent):**
```
✅ claude-code-cost-checker - Session Complete  
📝 Code refactoring completed successfully
⏱️ 45 min • 💬 23 messages
💰 Total: $0.2508
🔊 Glass sound
```

**Available Sounds (macOS):**
`Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`, `Hero`, `Morse`, `Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`

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
| `--notify-task` | Task completion notifications | `false` |
| `--notify-session` | Session completion notifications | `true` |
| `--notify-cost` | Cost update notifications | `true` |
| `--min-cost <amount>` | Minimum cost for notifications | `0.01` |
| `--sound` | Enable notification sound | `false` |
| `--task-sound <sound>` | Custom sound for task completion | `Pop` |
| `--session-sound <sound>` | Custom sound for session completion | `Glass` |
| `--max-age <minutes>` | Max age of messages to display | `5` |
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
   - Check "Play sound for notifications"

2. **Reset notification system:**
   ```bash
   sudo killall NotificationCenter
   ```

3. **Test notifications and sounds:**
   ```bash
   # Test default sounds
   npx tsx scripts/test-notification-sounds.ts
   
   # Test timeouts
   npx tsx scripts/test-notification-timeout.ts
   ```

### Common Issues

**Notifications not appearing:**
- Check Do Not Disturb mode is disabled
- Verify Terminal app has notification permissions
- Old messages might be filtered (adjust `--max-age`)

**Sounds not playing:**
- Ensure `--sound` flag is used
- Check system volume and notification sound settings
- Try different sound names (case-sensitive)

**Task/Session detection not working:**
- Task completion: Waits 3s after Claude's response
- Session completion: Triggered by 5min inactivity
- Use `--verbose` flag to see detection logs

## 📄 License

MIT © [Lab Bit](https://github.com/lab-bit)

## 🔗 Related Projects

- [Claude Code](https://claude.ai/code) - AI-powered coding assistant
