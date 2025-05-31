import { readFile, readFileSync, readdir, readdirSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { ClaudeMessage, MessageContent } from '../types/index.js';

const readFileAsync = promisify(readFile);
const readdirAsync = promisify(readdir);

export class JSONLParser {
  /**
   * Parse a JSONL file and return an array of messages
   */
  async parseFile(filePath: string): Promise<ClaudeMessage[]> {
    const content = await readFileAsync(filePath, 'utf-8');
    return this.parseContent(content);
  }

  /**
   * Parse a JSONL file synchronously
   */
  parseFileSync(filePath: string): ClaudeMessage[] {
    const content = readFileSync(filePath, 'utf-8');
    return this.parseContent(content);
  }

  /**
   * Parse JSONL content from string
   */
  parseContent(content: string): ClaudeMessage[] {
    const lines = content.split('\n').filter((line) => line.trim());
    const messages: ClaudeMessage[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ClaudeMessage;
        messages.push(parsed);
      } catch (error) {
        console.warn(`Failed to parse line: ${line.substring(0, 100)}...`, error);
      }
    }

    return messages;
  }

  /**
   * Parse a single JSONL line
   */
  parseLine(line: string): ClaudeMessage | null {
    try {
      return JSON.parse(line) as ClaudeMessage;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse the message content from the message field
   */
  parseMessageContent(message: ClaudeMessage): MessageContent | null {
    if (!message.message) return null;

    // Check if message is already an object
    if (typeof message.message === 'object') {
      return message.message as MessageContent;
    }

    // If it's a string, try to parse it
    if (typeof message.message !== 'string') {
      return null;
    }

    try {
      // First try direct JSON parse
      return JSON.parse(message.message) as MessageContent;
    } catch {
      // If that fails, try cleaning up the string
      try {
        const cleanedMessage = message.message
          .replace(/'/g, '"')
          .replace(/None/g, 'null')
          .replace(/True/g, 'true')
          .replace(/False/g, 'false')
          .replace(/(\w+):/g, '"$1":');

        return JSON.parse(cleanedMessage) as MessageContent;
      } catch (error) {
        // If the above fails, try a more robust parsing approach
        try {
          // Extract the actual content using regex
          const contentMatch = message.message.match(/'content':\s*'([^']*)'|"content":\s*"([^"]*)"/);
          const roleMatch = message.message.match(/'role':\s*['"](user|assistant)['"]/);
          const usageMatch = message.message.match(/'usage':\s*({[^}]+})/);

          if (roleMatch) {
            const content: Partial<MessageContent> = {
              role: roleMatch[1] as 'user' | 'assistant',
              content: contentMatch ? (contentMatch[1] || contentMatch[2]) : '',
            };

            if (usageMatch && usageMatch[1]) {
              try {
                const usageStr = usageMatch[1]
                  .replace(/'/g, '"')
                  .replace(/None/g, 'null');
                content.usage = JSON.parse(usageStr);
              } catch {
                // Ignore usage parsing errors
              }
            }

            return content as MessageContent;
          }
        } catch {
          // If all parsing attempts fail
        }
      }
    }

    console.warn('Failed to parse message content:', 
      typeof message.message === 'string' 
        ? message.message.substring(0, 100) 
        : JSON.stringify(message.message).substring(0, 100)
    );
    return null;
  }

  /**
   * Filter messages by type
   */
  filterByType(messages: ClaudeMessage[], type: 'user' | 'assistant' | 'summary'): ClaudeMessage[] {
    return messages.filter((msg) => msg.type === type);
  }

  /**
   * Filter messages by session
   */
  filterBySession(messages: ClaudeMessage[], sessionId: string): ClaudeMessage[] {
    return messages.filter((msg) => msg.sessionId === sessionId);
  }

  /**
   * Filter messages within a date range
   */
  filterByDateRange(messages: ClaudeMessage[], startDate: Date, endDate: Date): ClaudeMessage[] {
    return messages.filter((msg) => {
      const msgDate = new Date(msg.timestamp);
      return msgDate >= startDate && msgDate <= endDate;
    });
  }

  /**
   * Get unique session IDs from messages
   */
  getUniqueSessions(messages: ClaudeMessage[]): string[] {
    const sessions = new Set<string>();
    messages.forEach((msg) => {
      if (msg.sessionId) {
        sessions.add(msg.sessionId);
      }
    });
    return Array.from(sessions);
  }

  /**
   * Sort messages by timestamp
   */
  sortByTimestamp(messages: ClaudeMessage[], ascending = true): ClaudeMessage[] {
    return [...messages].sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return ascending ? dateA - dateB : dateB - dateA;
    });
  }

  /**
   * Group messages by session
   */
  groupBySession(messages: ClaudeMessage[]): Map<string, ClaudeMessage[]> {
    const grouped = new Map<string, ClaudeMessage[]>();

    messages.forEach((msg) => {
      if (msg.sessionId) {
        if (!grouped.has(msg.sessionId)) {
          grouped.set(msg.sessionId, []);
        }
        grouped.get(msg.sessionId)!.push(msg);
      }
    });

    return grouped;
  }

  /**
   * Calculate session duration
   */
  calculateSessionDuration(messages: ClaudeMessage[]): number {
    if (messages.length === 0) return 0;

    const sorted = this.sortByTimestamp(messages);
    if (sorted.length === 0) return 0;
    
    const firstMsg = sorted[0];
    const lastMsg = sorted[sorted.length - 1];
    
    if (!firstMsg || !lastMsg) return 0;
    
    const first = new Date(firstMsg.timestamp).getTime();
    const last = new Date(lastMsg.timestamp).getTime();

    return last - first;
  }

  /**
   * Parse all JSONL files in a directory
   */
  async parseDirectory(directoryPath: string): Promise<ClaudeMessage[]> {
    const files = await readdirAsync(directoryPath);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    const allMessages: ClaudeMessage[] = [];

    for (const file of jsonlFiles) {
      const filePath = join(directoryPath, file);
      try {
        const messages = await this.parseFile(filePath);
        allMessages.push(...messages);
      } catch (error) {
        console.warn(`Failed to parse file ${file}:`, error);
      }
    }

    return allMessages;
  }

  /**
   * Parse all JSONL files in a directory synchronously
   */
  parseDirectorySync(directoryPath: string): ClaudeMessage[] {
    const files = readdirSync(directoryPath);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    const allMessages: ClaudeMessage[] = [];

    for (const file of jsonlFiles) {
      const filePath = join(directoryPath, file);
      try {
        const messages = this.parseFileSync(filePath);
        allMessages.push(...messages);
      } catch (error) {
        console.warn(`Failed to parse file ${file}:`, error);
      }
    }

    return allMessages;
  }
}