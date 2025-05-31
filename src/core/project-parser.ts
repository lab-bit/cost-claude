import { ClaudeMessage } from '../types/index.js';
import path from 'path';

export class ProjectParser {
  /**
   * Extract project name from file path
   */
  static extractProjectName(filePath: string): string {
    // Get the project folder name from the file path
    const parts = filePath.split(path.sep);
    const projectsIndex = parts.indexOf('projects');
    
    if (projectsIndex >= 0 && projectsIndex < parts.length - 1) {
      const projectFolder = parts[projectsIndex + 1];
      if (projectFolder) {
        return this.formatProjectName(projectFolder);
      }
    }
    
    return 'unknown';
  }

  /**
   * Format project folder name for display
   */
  static formatProjectName(folderName: string): string {
    // Split by dash and take meaningful parts
    const parts = folderName.split('-').filter(p => p.length > 0);
    
    // Different formatting strategies
    if (parts.length > 3) {
      // Strategy 1: Take last 3 parts
      const lastThree = parts.slice(-3).join('-');
      
      // Strategy 2: If it's a GitHub project, show org/repo
      const githubIndex = parts.indexOf('github');
      if (githubIndex >= 0 && githubIndex < parts.length - 3) {
        const org = parts[githubIndex + 2];
        const repo = parts.slice(githubIndex + 3).join('-');
        if (org && repo) {
          return `${org}/${repo}`;
        }
      }
      
      // Strategy 3: If too long, take last 20 chars
      if (lastThree.length > 20) {
        return '...' + lastThree.slice(-20);
      }
      
      return lastThree;
    }
    
    return parts.join('-');
  }

  /**
   * Group messages by project
   */
  static groupByProject(messages: ClaudeMessage[]): Map<string, ClaudeMessage[]> {
    const grouped = new Map<string, ClaudeMessage[]>();
    
    messages.forEach(msg => {
      // Try to get project from cwd first (more accurate)
      let project = 'unknown';
      
      if (msg.cwd) {
        // Extract project name from current working directory
        const cwdParts = msg.cwd.split(path.sep);
        const repoIndex = cwdParts.lastIndexOf('github.com');
        
        if (repoIndex >= 0 && repoIndex < cwdParts.length - 2) {
          // GitHub project format: org/repo
          const org = cwdParts[repoIndex + 1];
          const repo = cwdParts[repoIndex + 2];
          if (org && repo) {
            project = `${org}/${repo}`;
          }
        } else {
          // Non-GitHub project: take last meaningful part
          project = cwdParts[cwdParts.length - 1] || 'unknown';
        }
      }
      
      if (!grouped.has(project)) {
        grouped.set(project, []);
      }
      grouped.get(project)!.push(msg);
    });
    
    return grouped;
  }

  /**
   * Extract project from message or file path
   */
  static getProjectFromMessage(message: ClaudeMessage, filePath?: string): string {
    // Try cwd first
    if (message.cwd) {
      const cwdParts = message.cwd.split(path.sep);
      const repoIndex = cwdParts.lastIndexOf('github.com');
      
      if (repoIndex >= 0 && repoIndex < cwdParts.length - 2) {
        const org = cwdParts[repoIndex + 1];
        const repo = cwdParts[repoIndex + 2];
        if (org && repo) {
          return `${org}/${repo}`;
        }
      }
      
      // Take last part of cwd
      const lastPart = cwdParts[cwdParts.length - 1];
      if (lastPart && lastPart !== 'undefined') {
        return lastPart;
      }
    }
    
    // Fallback to file path
    if (filePath) {
      return this.extractProjectName(filePath);
    }
    
    return 'unknown';
  }
}
