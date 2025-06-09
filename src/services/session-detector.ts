import { EventEmitter } from 'events';
import { ClaudeMessage } from '../types/index.js';
import { ProjectParser } from '../core/project-parser.js';
import { JSONLParser } from '../core/jsonl-parser.js';
import { CostCalculator } from '../core/cost-calculator.js';
import { logger } from '../utils/logger.js';

export interface SessionCompletionData {
  sessionId: string;
  projectName: string;
  summary: string;
  totalCost: number;
  messageCount: number;
  duration: number;
  startTime: Date;
  endTime: Date;
  lastMessageUuid: string;
}

export interface TaskCompletionData {
  sessionId: string;
  projectName: string;
  taskCost: number;
  taskDuration: number;
  assistantMessageCount: number;
  lastMessageUuid: string;
  timestamp: Date;
  completionType: 'immediate' | 'delayed';
}

export interface TaskProgressData {
  sessionId: string;
  projectName: string;
  currentCost: number;
  currentDuration: number;
  assistantMessageCount: number;
  isActive: boolean;
  estimatedCompletion?: number; // Estimated remaining time in ms
}

export interface SessionDetectorConfig {
  inactivityTimeout?: number; // Time in ms to consider session inactive
  summaryMessageTimeout?: number; // Time to wait after summary before considering complete
  taskCompletionTimeout?: number; // Time in ms after last assistant message to consider task complete
  delayedTaskCompletionTimeout?: number; // Longer timeout for delayed task completion (default: 30s)
  minTaskCost?: number; // Minimum cost to emit task completion event
  minTaskMessages?: number; // Minimum assistant messages to consider a task
  // Progress notification settings
  enableProgressNotifications?: boolean; // Enable progress notifications for long tasks
  progressCheckInterval?: number; // How often to check for progress (default: 10s)
  minProgressCost?: number; // Minimum cost for progress notification
  minProgressDuration?: number; // Minimum duration for progress notification (default: 15s)
}

export class SessionDetector extends EventEmitter {
  private jsonlParser: JSONLParser;
  private costCalculator: CostCalculator;
  private sessions: Map<string, {
    messages: ClaudeMessage[];
    totalCost: number;
    startTime: Date;
    lastActivity: Date;
    projectName: string;
    hasSummary: boolean;
    summaryText?: string;
    lastMessageUuid?: string;
    filePath?: string;
    summaryTimer?: NodeJS.Timeout;
    inactivityTimer?: NodeJS.Timeout;
    taskTimer?: NodeJS.Timeout;
    delayedTaskTimer?: NodeJS.Timeout;
    progressTimer?: NodeJS.Timeout;
    currentTaskStartTime?: Date;
    currentTaskCost: number;
    currentTaskAssistantCount: number;
    lastAssistantMessageTime?: Date;
    lastProgressNotificationTime?: Date;
    taskInProgress: boolean;
  }> = new Map();

  private config: Required<SessionDetectorConfig>;

  constructor(config: SessionDetectorConfig = {}) {
    super();
    this.jsonlParser = new JSONLParser();
    this.costCalculator = new CostCalculator();
    // Initialize cost calculator rates asynchronously
    this.costCalculator.ensureRatesLoaded().catch(err => {
      logger.error('Failed to load pricing rates:', err);
    });
    this.config = {
      inactivityTimeout: config.inactivityTimeout ?? 300000, // 5 minutes default
      summaryMessageTimeout: config.summaryMessageTimeout ?? 5000, // 5 seconds after summary
      taskCompletionTimeout: config.taskCompletionTimeout ?? 3000, // 3 seconds after last assistant message
      delayedTaskCompletionTimeout: config.delayedTaskCompletionTimeout ?? 30000, // 30 seconds for delayed completion
      minTaskCost: config.minTaskCost ?? 0.01, // Minimum $0.01 to consider task significant
      minTaskMessages: config.minTaskMessages ?? 1, // At least 1 assistant message
      enableProgressNotifications: config.enableProgressNotifications ?? true,
      progressCheckInterval: config.progressCheckInterval ?? 10000, // Check every 10 seconds
      minProgressCost: config.minProgressCost ?? 0.02, // Minimum $0.02 for progress notification
      minProgressDuration: config.minProgressDuration ?? 15000, // 15 seconds minimum
    };
  }

  /**
   * Process a new message and detect session patterns
   */
  processMessage(message: ClaudeMessage, filePath?: string): void {
    const sessionId = message.sessionId || 'unknown';
    
    // Initialize session if not exists
    if (!this.sessions.has(sessionId)) {
      const projectName = ProjectParser.getProjectFromMessage(message, filePath);
      this.sessions.set(sessionId, {
        messages: [],
        totalCost: 0,
        startTime: new Date(message.timestamp),
        lastActivity: new Date(message.timestamp),
        projectName,
        hasSummary: false,
        filePath,
        currentTaskCost: 0,
        currentTaskAssistantCount: 0,
        taskInProgress: false
      });
      logger.debug(`New session detected: ${sessionId} for project: ${projectName}`);
    }

    const session = this.sessions.get(sessionId)!;
    
    // Update session data
    session.messages.push(message);
    session.lastActivity = new Date(message.timestamp);
    session.lastMessageUuid = message.uuid;
    
    // Clear existing timers
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
    }
    if (session.summaryTimer) {
      clearTimeout(session.summaryTimer);
    }
    if (session.taskTimer) {
      clearTimeout(session.taskTimer);
    }
    if (session.delayedTaskTimer) {
      clearTimeout(session.delayedTaskTimer);
    }
    if (session.progressTimer) {
      clearTimeout(session.progressTimer);
    }

    // Process based on message type
    if (message.type === 'user') {
      // User message starts a new task
      if (session.currentTaskAssistantCount > 0) {
        // If there was a previous task, it's now interrupted
        logger.debug(`Task interrupted by new user message in session ${sessionId}`);
      }
      // Reset task tracking
      session.currentTaskStartTime = new Date(message.timestamp);
      session.currentTaskCost = 0;
      session.currentTaskAssistantCount = 0;
      session.lastAssistantMessageTime = undefined;
      session.taskInProgress = false;
      session.lastProgressNotificationTime = undefined;
    } else if (message.type === 'assistant') {
      // Calculate message cost
      let messageCost = 0;
      if (message.costUSD !== null && message.costUSD !== undefined) {
        messageCost = message.costUSD;
      } else {
        // Fallback: calculate cost from token usage
        const content = this.jsonlParser.parseMessageContent(message);
        if (content?.usage) {
          messageCost = this.costCalculator.calculate(content.usage);
        }
      }
      
      session.totalCost += messageCost;
      
      // Update task tracking
      if (!session.currentTaskStartTime) {
        session.currentTaskStartTime = new Date(message.timestamp);
      }
      session.currentTaskCost += messageCost;
      session.currentTaskAssistantCount++;
      session.lastAssistantMessageTime = new Date(message.timestamp);
      session.taskInProgress = true;
      
      // Set immediate task completion timer
      session.taskTimer = setTimeout(() => {
        this.completeTask(sessionId, 'immediate');
      }, this.config.taskCompletionTimeout);
      
      // Set delayed task completion timer for more confident detection
      session.delayedTaskTimer = setTimeout(() => {
        this.completeTask(sessionId, 'delayed');
      }, this.config.delayedTaskCompletionTimeout);
      
      // Start progress monitoring if enabled
      if (this.config.enableProgressNotifications && !session.progressTimer) {
        this.startProgressMonitoring(sessionId);
      }
      
      logger.debug(`Assistant message in session ${sessionId}, immediate timer: ${this.config.taskCompletionTimeout}ms, delayed timer: ${this.config.delayedTaskCompletionTimeout}ms`);
    } else if (message.type === 'summary') {
      // Summary message detected - this often indicates task completion
      session.hasSummary = true;
      session.summaryText = message.summary || 'Task completed';
      
      logger.debug(`Summary detected for session ${sessionId}: ${session.summaryText}`);
      
      // Set a short timer to complete the session after summary
      session.summaryTimer = setTimeout(() => {
        this.completeSession(sessionId, 'summary');
      }, this.config.summaryMessageTimeout);
      
      return; // Don't set inactivity timer for summary messages
    }

    // Set inactivity timer for non-summary messages
    session.inactivityTimer = setTimeout(() => {
      this.completeSession(sessionId, 'inactivity');
    }, this.config.inactivityTimeout);
  }

  /**
   * Start progress monitoring for a task
   */
  private startProgressMonitoring(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Clear existing progress timer
    if (session.progressTimer) {
      clearTimeout(session.progressTimer);
    }
    
    session.progressTimer = setInterval(() => {
      this.checkTaskProgress(sessionId);
    }, this.config.progressCheckInterval);
  }
  
  /**
   * Check task progress and emit notifications if needed
   */
  private checkTaskProgress(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskInProgress) {
      // Stop monitoring if no task in progress
      if (session?.progressTimer) {
        clearInterval(session.progressTimer);
        session.progressTimer = undefined;
      }
      return;
    }
    
    const now = Date.now();
    const taskDuration = session.lastAssistantMessageTime 
      ? now - (session.currentTaskStartTime?.getTime() || 0)
      : 0;
    
    // Check if task meets progress notification criteria
    if (taskDuration >= this.config.minProgressDuration && 
        session.currentTaskCost >= this.config.minProgressCost) {
      
      // Don't send too frequent progress notifications
      const timeSinceLastNotification = session.lastProgressNotificationTime 
        ? now - session.lastProgressNotificationTime.getTime()
        : Infinity;
      
      if (timeSinceLastNotification >= this.config.progressCheckInterval) {
        const progressData: TaskProgressData = {
          sessionId,
          projectName: session.projectName,
          currentCost: session.currentTaskCost,
          currentDuration: taskDuration,
          assistantMessageCount: session.currentTaskAssistantCount,
          isActive: true,
          estimatedCompletion: this.estimateCompletion(session)
        };
        
        logger.debug(`Task progress in session ${sessionId}`, {
          cost: progressData.currentCost,
          duration: progressData.currentDuration,
          messages: progressData.assistantMessageCount
        });
        
        this.emit('task-progress', progressData);
        session.lastProgressNotificationTime = new Date(now);
      }
    }
  }
  
  /**
   * Estimate task completion time based on recent activity
   */
  private estimateCompletion(session: any): number | undefined {
    if (!session.lastAssistantMessageTime) return undefined;
    
    const timeSinceLastMessage = Date.now() - session.lastAssistantMessageTime.getTime();
    const averageMessageInterval = session.currentTaskAssistantCount > 1 
      ? (session.lastAssistantMessageTime.getTime() - session.currentTaskStartTime.getTime()) / session.currentTaskAssistantCount
      : 5000; // Default 5 seconds if only one message
    
    // If we're past the average interval, task might be completing soon
    if (timeSinceLastMessage > averageMessageInterval * 2) {
      return Math.min(5000, this.config.taskCompletionTimeout - timeSinceLastMessage);
    }
    
    // Otherwise estimate based on pattern
    return averageMessageInterval * 2;
  }
  
  /**
   * Complete a task and emit task completion event
   */
  private completeTask(sessionId: string, completionType: 'immediate' | 'delayed' = 'immediate'): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.currentTaskAssistantCount === 0) return;
    
    // Clear all task-related timers
    if (session.taskTimer) {
      clearTimeout(session.taskTimer);
      session.taskTimer = undefined;
    }
    if (session.delayedTaskTimer) {
      clearTimeout(session.delayedTaskTimer);
      session.delayedTaskTimer = undefined;
    }
    if (session.progressTimer) {
      clearInterval(session.progressTimer);
      session.progressTimer = undefined;
    }
    
    // Check if task meets minimum thresholds
    if (session.currentTaskCost < this.config.minTaskCost || 
        session.currentTaskAssistantCount < this.config.minTaskMessages) {
      logger.debug(`Task in session ${sessionId} below thresholds (cost: ${session.currentTaskCost}, messages: ${session.currentTaskAssistantCount})`);
      // Still reset task tracking
      session.currentTaskCost = 0;
      session.currentTaskAssistantCount = 0;
      session.currentTaskStartTime = undefined;
      session.lastAssistantMessageTime = undefined;
      session.taskInProgress = false;
      session.lastProgressNotificationTime = undefined;
      return;
    }
    
    // Calculate task duration
    const taskDuration = session.lastAssistantMessageTime 
      ? session.lastAssistantMessageTime.getTime() - (session.currentTaskStartTime?.getTime() || 0)
      : 0;
    
    // Prepare task completion data
    const taskCompletionData: TaskCompletionData = {
      sessionId,
      projectName: session.projectName,
      taskCost: session.currentTaskCost,
      taskDuration,
      assistantMessageCount: session.currentTaskAssistantCount,
      lastMessageUuid: session.lastMessageUuid || '',
      timestamp: session.lastAssistantMessageTime || new Date(),
      completionType
    };
    
    logger.debug(`Task completed in session ${sessionId} (${completionType})`, {
      cost: taskCompletionData.taskCost,
      messages: taskCompletionData.assistantMessageCount,
      duration: taskCompletionData.taskDuration,
      completionType
    });
    
    // Emit task completion event
    this.emit('task-completed', taskCompletionData);
    
    // Reset task tracking for potential next task
    session.currentTaskCost = 0;
    session.currentTaskAssistantCount = 0;
    session.currentTaskStartTime = undefined;
    session.lastAssistantMessageTime = undefined;
    session.taskInProgress = false;
    session.lastProgressNotificationTime = undefined;
  }

  /**
   * Complete a session and emit completion event
   */
  private completeSession(sessionId: string, reason: 'summary' | 'inactivity' | 'manual'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear any remaining timers
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
    }
    if (session.summaryTimer) {
      clearTimeout(session.summaryTimer);
    }
    if (session.taskTimer) {
      clearTimeout(session.taskTimer);
    }
    if (session.delayedTaskTimer) {
      clearTimeout(session.delayedTaskTimer);
    }
    if (session.progressTimer) {
      clearInterval(session.progressTimer);
    }

    // Calculate session duration
    const duration = session.lastActivity.getTime() - session.startTime.getTime();

    // Prepare completion data
    const completionData: SessionCompletionData = {
      sessionId,
      projectName: session.projectName,
      summary: session.summaryText || this.generateSummary(session.messages),
      totalCost: session.totalCost,
      messageCount: session.messages.length,
      duration,
      startTime: session.startTime,
      endTime: session.lastActivity,
      lastMessageUuid: session.lastMessageUuid || ''
    };

    logger.debug(`Session completed (${reason}): ${sessionId}`, {
      project: completionData.projectName,
      cost: completionData.totalCost,
      messages: completionData.messageCount,
      duration: completionData.duration
    });

    // Emit completion event
    this.emit('session-completed', completionData);

    // Remove session from tracking
    this.sessions.delete(sessionId);
  }

  /**
   * Generate a summary for sessions without explicit summary messages
   */
  private generateSummary(messages: ClaudeMessage[]): string {
    const userMessages = messages.filter(m => m.type === 'user').length;
    const assistantMessages = messages.filter(m => m.type === 'assistant').length;
    
    if (userMessages === 0) {
      return 'No user interaction';
    } else if (assistantMessages === 0) {
      return 'No assistant responses';
    } else {
      return `${userMessages} questions, ${assistantMessages} responses`;
    }
  }

  /**
   * Manually complete a session (useful for shutdown)
   */
  completeAllSessions(): void {
    const sessionIds = Array.from(this.sessions.keys());
    sessionIds.forEach(sessionId => {
      this.completeSession(sessionId, 'manual');
    });
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId,
      projectName: session.projectName,
      totalCost: session.totalCost,
      messageCount: session.messages.length,
      hasSummary: session.hasSummary,
      lastActivity: session.lastActivity,
      duration: session.lastActivity.getTime() - session.startTime.getTime()
    };
  }

  /**
   * Check if a session is considered idle
   */
  isSessionIdle(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const idleTime = Date.now() - session.lastActivity.getTime();
    return idleTime > this.config.inactivityTimeout;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionDetectorConfig>): void {
    if (config.inactivityTimeout !== undefined) {
      this.config.inactivityTimeout = config.inactivityTimeout;
    }
    if (config.summaryMessageTimeout !== undefined) {
      this.config.summaryMessageTimeout = config.summaryMessageTimeout;
    }
    if (config.taskCompletionTimeout !== undefined) {
      this.config.taskCompletionTimeout = config.taskCompletionTimeout;
    }
    if (config.delayedTaskCompletionTimeout !== undefined) {
      this.config.delayedTaskCompletionTimeout = config.delayedTaskCompletionTimeout;
    }
    if (config.minTaskCost !== undefined) {
      this.config.minTaskCost = config.minTaskCost;
    }
    if (config.minTaskMessages !== undefined) {
      this.config.minTaskMessages = config.minTaskMessages;
    }
    if (config.enableProgressNotifications !== undefined) {
      this.config.enableProgressNotifications = config.enableProgressNotifications;
    }
    if (config.progressCheckInterval !== undefined) {
      this.config.progressCheckInterval = config.progressCheckInterval;
    }
    if (config.minProgressCost !== undefined) {
      this.config.minProgressCost = config.minProgressCost;
    }
    if (config.minProgressDuration !== undefined) {
      this.config.minProgressDuration = config.minProgressDuration;
    }
  }
}