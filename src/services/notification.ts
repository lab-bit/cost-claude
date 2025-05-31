import notifier from 'node-notifier';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { formatCostAdaptive, formatDuration, formatCompactNumber, shortenProjectName } from '../utils/format.js';

export interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: boolean | string;
  icon?: string;
  timeout?: number;
  actions?: string[];
  closeLabel?: string;
  dropdownLabel?: string;
}

export interface CostNotificationData {
  sessionId: string;
  messageId: string;
  cost: number;
  duration: number;
  tokens: {
    input: number;
    output: number;
    cacheHit: number;
  };
  sessionTotal?: number;
  dailyTotal?: number;
  projectName?: string;
}

export interface NotificationConfig {
  soundEnabled?: boolean;
  customIcon?: string;
  customSound?: string; // Custom sound name for macOS
  forceDisplay?: boolean; // Force display even in Do Not Disturb mode
  thresholds?: {
    cost?: number;
    duration?: number;
  };
}

export class NotificationService extends EventEmitter {
  private iconPath: string;
  private soundEnabled: boolean;
  private platform: NodeJS.Platform;
  private lastNotificationTime = 0;
  private notificationThrottle = 1000; // 1 second minimum between notifications
  constructor(private config: NotificationConfig = {}) {
    super();
    this.platform = process.platform;
    this.iconPath = this.resolveIconPath();
    this.soundEnabled = config.soundEnabled ?? true;
  }

  async notifyCostUpdate(data: CostNotificationData): Promise<void> {
    // Throttle notifications
    const now = Date.now();
    if (now - this.lastNotificationTime < this.notificationThrottle) {
      logger.debug('Notification throttled');
      return;
    }
    this.lastNotificationTime = now;

    const title = this.formatTitle(data);
    const message = this.formatMessage(data);
    const subtitle = this.formatSubtitle(data);

    const options: NotificationOptions = {
      title,
      message,
      subtitle,
      sound: this.soundEnabled ? this.getSound() : false,
      icon: this.iconPath,
      // timeout removed - let user dismiss manually
    };

    await this.notify(options);
  }

  async notify(options: NotificationOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const notificationOptions: any = {
          title: options.title,
          message: options.message,
          sound: options.sound,
          icon: options.icon,
          contentImage: options.icon,
          wait: false,
        };

        // Platform-specific options
        if (this.platform === 'darwin') {
          notificationOptions.subtitle = options.subtitle;
          notificationOptions.closeLabel = options.closeLabel;
          notificationOptions.actions = options.actions;
          notificationOptions.dropdownLabel = options.dropdownLabel;
          // macOS specific settings for better visibility
          notificationOptions.timeout = 86400; // 24 hours
          notificationOptions.sender = 'com.apple.Terminal'; // Use Terminal's bundle ID
          notificationOptions.activate = 'com.apple.Terminal'; // Activate Terminal when clicked
          
          // Don't force display in Do Not Disturb mode as requested by user
          // notificationOptions.ignoreDnD = true;
          notificationOptions.bundleId = 'com.apple.Terminal';
        } else if (this.platform === 'win32') {
          // Windows-specific options
          notificationOptions.appID = 'Cost Claude';
          notificationOptions.timeout = 86400; // 24 hours
        } else {
          // Linux/others
          notificationOptions.timeout = 86400; // 24 hours
        }

        // Create handlers before adding listeners
        const clickHandler = (_notifierObject: any, options: any, event: any) => {
          logger.debug('Notification clicked');
          this.emit('click', { options, event });
        };

        const timeoutHandler = (_notifierObject: any, options: any) => {
          logger.debug('Notification timed out');
          this.emit('timeout', options);
        };

        // Remove any existing listeners first to prevent memory leaks
        notifier.removeAllListeners('click');
        notifier.removeAllListeners('timeout');

        // Add event listeners
        notifier.on('click', clickHandler);
        notifier.on('timeout', timeoutHandler);

        // Log notification options for debugging
        logger.debug('Sending notification with options:', {
          title: notificationOptions.title,
          platform: this.platform,
          sender: notificationOptions.sender,
          bundleId: notificationOptions.bundleId,
          ignoreDnD: notificationOptions.ignoreDnD,
          timeout: notificationOptions.timeout
        });

        notifier.notify(notificationOptions, (err: any, response: any) => {
          // Clean up listeners after notification is sent
          notifier.removeListener('click', clickHandler);
          notifier.removeListener('timeout', timeoutHandler);
          
          if (err) {
            // Check if the error is due to SIGINT (process termination)
            if (err.signal === 'SIGINT' || err.killed) {
              logger.debug('Notification cancelled due to process termination');
              resolve(); // Don't treat SIGINT as an error
            } else if (err.message && err.message.includes('JSON')) {
              // JSON parse errors from node-notifier are often non-critical
              logger.debug('Notification JSON parse warning (notification likely still sent):', err.message);
              resolve(); // Don't treat JSON parse errors as critical failures
            } else {
              logger.error('Notification error:', err);
              logger.debug('Full error details:', err);
              this.emit('error', err);
              reject(err);
            }
          } else {
            logger.debug('Notification sent successfully', response);
            this.emit('sent', { options, response });
            resolve();
          }
        });

      } catch (error) {
        logger.error('Failed to send notification:', error);
        reject(error);
      }
    });
  }

  private formatTitle(data: CostNotificationData): string {
    const emoji = this.getCostEmoji(data.cost);
    const projectPart = data.projectName ? ` - ${shortenProjectName(data.projectName)}` : '';
    return `${formatCostAdaptive(data.cost)} ${emoji}${projectPart}`;
  }

  private formatMessage(data: CostNotificationData): string {
    const lines = [];

    // Duration
    lines.push(`⏱️ ${formatDuration(data.duration)}`);
    
    // Token info (simplified)
    const totalTokens = data.tokens.input + data.tokens.output;
    lines.push(`📝 ${formatCompactNumber(totalTokens)} tokens`);

    // Session total if available
    if (data.sessionTotal !== undefined && data.sessionTotal > data.cost) {
      lines.push(`Σ ${formatCostAdaptive(data.sessionTotal)}`);
    }

    return lines.join(' • ');
  }

  private formatSubtitle(_data: CostNotificationData): string | undefined {
    // Removed subtitle to keep notification compact
    return undefined;
  }

  private getCostEmoji(cost: number): string {
    if (cost < 0.01) return '✅';
    if (cost < 0.05) return '💚';
    if (cost < 0.10) return '💛';
    if (cost < 0.50) return '🧡';
    if (cost < 1.00) return '❤️';
    return '💸';
  }

  private resolveIconPath(): string {
    if (this.config.customIcon) {
      return this.config.customIcon;
    }

    // Try to use a default icon (you would need to add icon files to your project)
    // const iconName = this.platform === 'win32' ? 'icon.ico' : 'icon.png';
    // const defaultPath = join(__dirname, '../../assets', iconName);
    
    // For now, return terminal icon as fallback
    return this.platform === 'darwin' ? 'Terminal' : '';
  }

  private getSound(): string | boolean {
    if (!this.soundEnabled) return false;

    if (this.platform === 'darwin') {
      // Use custom sound if specified, otherwise default
      if (this.config.customSound) {
        return this.config.customSound;
      }
      
      // macOS system sounds - you can choose from:
      // 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 
      // 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'
      return 'Ping'; // Default sound
    } else if (this.platform === 'win32') {
      // Windows uses boolean for default sound
      return true;
    }
    
    return false;
  }

  /**
   * Send a custom notification
   */
  async sendCustom(title: string, message: string, options?: Partial<NotificationOptions>): Promise<void> {
    await this.notify({
      title,
      message,
      sound: this.soundEnabled,
      icon: this.iconPath,
      ...options,
    });
  }

  /**
   * Send an error notification
   */
  async sendError(error: Error | string): Promise<void> {
    const message = error instanceof Error ? error.message : error;
    await this.sendCustom('❌ Claude Code Error', message, {
      sound: true,
    });
  }

  /**
   * Send a warning notification
   */
  async sendWarning(message: string): Promise<void> {
    await this.sendCustom('⚠️ Claude Code Warning', message, {
      sound: this.soundEnabled,
    });
  }

  /**
   * Send a success notification
   */
  async sendSuccess(message: string): Promise<void> {
    await this.sendCustom('✅ Claude Code', message, {
      sound: false,
    });
  }

  /**
   * Check if notifications are supported on the current platform
   */
  isSupported(): boolean {
    return ['darwin', 'win32', 'linux'].includes(this.platform);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    if (config.soundEnabled !== undefined) {
      this.soundEnabled = config.soundEnabled;
    }
    if (config.customIcon !== undefined) {
      this.iconPath = config.customIcon;
    }
    if (config.thresholds !== undefined) {
      this.config.thresholds = { ...this.config.thresholds, ...config.thresholds };
    }
  }
}