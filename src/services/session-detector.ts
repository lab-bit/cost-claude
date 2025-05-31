import { EventEmitter } from 'events';
import { ClaudeMessage } from '../types/index.js';
import { ProjectParser } from '../core/project-parser.js';
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
}

export interface SessionDetectorConfig {
  inactivityTimeout?: number; // Time in ms to consider session inactive
  summaryMessageTimeout?: number; // Time to wait after summary before considering complete
  taskCompletionTimeout?: number; // Time in ms after last assistant message to consider task complete
}

export class SessionDetector extends EventEmitter {
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
    currentTaskStartTime?: Date;
    currentTaskCost: number;
    currentTaskAssistantCount: number;
    lastAssistantMessageTime?: Date;
  }> = new Map();

  private config: Required<SessionDetectorConfig>;

  constructor(config: SessionDetectorConfig = {}) {
    super();
    this.config = {
      inactivityTimeout: config.inactivityTimeout ?? 300000, // 5 minutes default
      summaryMessageTimeout: config.summaryMessageTimeout ?? 5000, // 5 seconds after summary
      taskCompletionTimeout: config.taskCompletionTimeout ?? 3000, // 3 seconds after last assistant message
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
        currentTaskAssistantCount: 0
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
    } else if (message.type === 'assistant' && message.costUSD) {
      session.totalCost += message.costUSD;
      
      // Update task tracking
      if (!session.currentTaskStartTime) {
        session.currentTaskStartTime = new Date(message.timestamp);
      }
      session.currentTaskCost += message.costUSD;
      session.currentTaskAssistantCount++;
      session.lastAssistantMessageTime = new Date(message.timestamp);
      
      // Set task completion timer
      session.taskTimer = setTimeout(() => {
        this.completeTask(sessionId);
      }, this.config.taskCompletionTimeout);
      
      logger.debug(`Assistant message in session ${sessionId}, task timer set for ${this.config.taskCompletionTimeout}ms`);
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
   * Complete a task and emit task completion event
   */
  private completeTask(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.currentTaskAssistantCount === 0) return;
    
    // Clear task timer
    if (session.taskTimer) {
      clearTimeout(session.taskTimer);
      session.taskTimer = undefined;
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
      timestamp: session.lastAssistantMessageTime || new Date()
    };
    
    logger.debug(`Task completed in session ${sessionId}`, {
      cost: taskCompletionData.taskCost,
      messages: taskCompletionData.assistantMessageCount,
      duration: taskCompletionData.taskDuration
    });
    
    // Emit task completion event
    this.emit('task-completed', taskCompletionData);
    
    // Reset task tracking for potential next task
    session.currentTaskCost = 0;
    session.currentTaskAssistantCount = 0;
    session.currentTaskStartTime = undefined;
    session.lastAssistantMessageTime = undefined;
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
  }
}