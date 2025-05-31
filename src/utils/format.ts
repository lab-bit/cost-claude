import chalk from 'chalk';

/**
 * Format numbers with thousand separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format large numbers in a compact form (K, M, B)
 */
export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.round((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Format percentage with color coding
 */
export function formatPercentage(value: number, good = true): string {
  const formatted = `${value.toFixed(1)}%`;
  
  if (good) {
    if (value >= 80) return chalk.green(formatted);
    if (value >= 50) return chalk.yellow(formatted);
    return chalk.red(formatted);
  } else {
    if (value <= 20) return chalk.green(formatted);
    if (value <= 50) return chalk.yellow(formatted);
    return chalk.red(formatted);
  }
}

/**
 * Format cost with color coding
 */
export function formatCostColored(cost: number): string {
  const formatted = `$${cost.toFixed(4)}`;
  
  if (cost < 0.01) return chalk.green(formatted);
  if (cost < 0.1) return chalk.yellow(formatted);
  if (cost < 1) return chalk.magenta(formatted);
  return chalk.red(formatted);
}

/**
 * Format cost with appropriate precision based on amount
 */
export function formatCostAdaptive(cost: number): string {
  if (cost >= 10) {
    return `$${cost.toFixed(2)}`;
  } else if (cost >= 1) {
    return `$${cost.toFixed(3)}`;
  } else {
    return `$${cost.toFixed(4)}`;
  }
}

/**
 * Format cost without color (for notifications)
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/**
 * Shorten project name for notifications
 */
export function shortenProjectName(projectName: string, maxLength: number = 20): string {
  if (projectName.length <= maxLength) {
    return projectName;
  }
  
  // Try to extract just the repo name from org/repo format
  const parts = projectName.split('/');
  if (parts.length >= 2) {
    const repoName = parts[parts.length - 1];
    if (repoName && repoName.length <= maxLength) {
      return repoName;
    }
    // If repo name is still too long, truncate it
    if (repoName) {
      return repoName.substring(0, maxLength - 3) + '...';
    }
  }
  
  // Fallback: truncate the whole name
  return projectName.substring(0, maxLength - 3) + '...';
}

/**
 * Format timestamp in local time
 */
export function formatTimestamp(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format date in YYYY-MM-DD format
 */
export function formatDate(date: Date): string {
  // Check if date is valid
  if (!date || isNaN(date.getTime())) {
    return 'Invalid Date';
  }
  return date.toISOString().split('T')[0]!;
}

/**
 * Create a progress bar
 */
export function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = Math.min(current / total, 1);
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentStr = `${(percentage * 100).toFixed(0)}%`;
  
  return `[${bar}] ${percentStr}`;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Create a table separator line
 */
export function createSeparator(length: number, char = '─'): string {
  return char.repeat(length);
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}