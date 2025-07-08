import { google } from 'googleapis';
import { GmailAuth } from './auth/gmail-auth.js';
import { 
  EmailMessage, 
  EmailSearchResult, 
  UnsubscribeLink, 
  EmailDeletionResult,
  EmailStats,
  OperationLog 
} from './types/gmail.js';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

export class GmailClient {
  private auth: GmailAuth;
  private gmail: any;
  private operationLogs: OperationLog[] = [];
  private readonly LOG_FILE = 'email-operations.log';

  constructor() {
    this.auth = new GmailAuth();
  }

  async initialize(): Promise<void> {
    try {
      if (!this.auth.isAuthenticated()) {
        await this.auth.authenticate();
      }
      
      const authClient = this.auth.getAuthenticatedClient();
      this.gmail = google.gmail({ version: 'v1', auth: authClient });
      
      // Ensure log directory exists
      if (!existsSync('logs')) {
        mkdirSync('logs', { recursive: true });
      }
      
      // Gmail client initialized successfully
    } catch (error) {
      throw error;
    }
  }

  private logOperation(operation: OperationLog): void {
    this.operationLogs.push(operation);
    const logEntry = `${new Date().toISOString()} - ${operation.operation}: ${JSON.stringify(operation)}\n`;
    appendFileSync(this.LOG_FILE, logEntry);
  }

  async searchEmails(query: string, maxResults: number = 100, includeSpamTrash: boolean = false): Promise<EmailSearchResult> {
    await this.auth.refreshTokenIfNeeded();
    
    const operation: OperationLog = {
      timestamp: new Date().toISOString(),
      operation: 'search',
      query,
      dryRun: false,
      success: false
    };

    try {
      const searchParams: any = {
        userId: 'me',
        q: query,
        maxResults: Math.min(maxResults, 500) // Gmail API max is 500
      };

      if (includeSpamTrash) {
        searchParams.includeSpamTrash = true;
      }

      const response = await this.gmail.users.messages.list(searchParams);
      const messages = response.data.messages || [];

      // Get full message details for each email
      const emailMessages: EmailMessage[] = [];
      for (const message of messages) {
        try {
          const fullMessage = await this.gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
          });
          
          emailMessages.push({
            id: fullMessage.data.id,
            threadId: fullMessage.data.threadId,
            snippet: fullMessage.data.snippet,
            internalDate: fullMessage.data.internalDate,
            payload: fullMessage.data.payload
          });
        } catch (error) {
          // Skip messages that can't be fetched
        }
      }

      const result: EmailSearchResult = {
        messages: emailMessages,
        totalResults: response.data.resultSizeEstimate || 0,
        nextPageToken: response.data.nextPageToken
      };

      operation.success = true;
      operation.count = emailMessages.length;
      this.logOperation(operation);

      return result;
    } catch (error) {
      operation.success = false;
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      this.logOperation(operation);
      throw new Error(`Failed to search emails: ${error}`);
    }
  }

  async countEmails(query: string, includeSpamTrash: boolean = false): Promise<number> {
    await this.auth.refreshTokenIfNeeded();
    
    const operation: OperationLog = {
      timestamp: new Date().toISOString(),
      operation: 'count',
      query,
      dryRun: false,
      success: false
    };

    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 1,
        includeSpamTrash
      });

      const count = response.data.resultSizeEstimate || 0;
      
      operation.success = true;
      operation.count = count;
      this.logOperation(operation);

      return count;
    } catch (error) {
      operation.success = false;
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      this.logOperation(operation);
      throw new Error(`Failed to count emails: ${error}`);
    }
  }

  async deleteEmails(query: string, dryRun: boolean = true, maxDeletions: number = 100): Promise<EmailDeletionResult> {
    await this.auth.refreshTokenIfNeeded();
    
    const operation: OperationLog = {
      timestamp: new Date().toISOString(),
      operation: 'delete',
      query,
      dryRun,
      success: false
    };

    try {
      // First, search for emails to delete
      const searchResult = await this.searchEmails(query, maxDeletions);
      const messageIds = searchResult.messages.map(m => m.id);

      if (messageIds.length === 0) {
        operation.success = true;
        operation.count = 0;
        this.logOperation(operation);
        return { deletedCount: 0, failedCount: 0, errors: [] };
      }

      // Safety check - limit deletions
      if (messageIds.length > maxDeletions) {
        throw new Error(`Too many emails to delete (${messageIds.length}). Maximum allowed: ${maxDeletions}`);
      }

      if (dryRun) {
        // Dry run mode - no actual deletion
        operation.success = true;
        operation.count = messageIds.length;
        this.logOperation(operation);
        return { deletedCount: 0, failedCount: 0, errors: [`DRY RUN: Would delete ${messageIds.length} emails`] };
      }

      // Perform actual deletion in batches
      const batchSize = 100; // Gmail API supports up to 1000, but we'll be conservative
      let deletedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize);
        
        try {
          await this.gmail.users.messages.batchDelete({
            userId: 'me',
            requestBody: {
              ids: batch
            }
          });
          deletedCount += batch.length;
          // Batch deletion successful
        } catch (error) {
          failedCount += batch.length;
          const errorMsg = `Failed to delete batch: ${error}`;
          errors.push(errorMsg);
          // Batch deletion failed - error logged to errors array
        }

        // Rate limiting - pause between batches
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      operation.success = failedCount === 0;
      operation.count = deletedCount;
      this.logOperation(operation);

      return { deletedCount, failedCount, errors };
    } catch (error) {
      operation.success = false;
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      this.logOperation(operation);
      throw new Error(`Failed to delete emails: ${error}`);
    }
  }

  async getEmailDetails(messageId: string, includeHeaders: boolean = true, includeBody: boolean = false): Promise<EmailMessage> {
    await this.auth.refreshTokenIfNeeded();

    try {
      const format = includeBody ? 'full' : (includeHeaders ? 'metadata' : 'minimal');
      
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format
      });

      return {
        id: response.data.id,
        threadId: response.data.threadId,
        snippet: response.data.snippet,
        internalDate: response.data.internalDate,
        payload: response.data.payload
      };
    } catch (error) {
      throw new Error(`Failed to get email details: ${error}`);
    }
  }

  async findUnsubscribeLinks(query: string, maxResults: number = 50, verifyLinks: boolean = true): Promise<UnsubscribeLink[]> {
    await this.auth.refreshTokenIfNeeded();
    
    const operation: OperationLog = {
      timestamp: new Date().toISOString(),
      operation: 'unsubscribe',
      query,
      dryRun: false,
      success: false
    };

    try {
      const searchResult = await this.searchEmails(query, maxResults);
      const unsubscribeLinks: UnsubscribeLink[] = [];

      for (const message of searchResult.messages) {
        // Check List-Unsubscribe header
        if (message.payload?.headers) {
          const unsubscribeHeader = message.payload.headers.find(h => 
            h.name.toLowerCase() === 'list-unsubscribe'
          );
          
          if (unsubscribeHeader) {
            const urls = this.extractUrlsFromHeader(unsubscribeHeader.value);
            urls.forEach(url => {
              unsubscribeLinks.push({
                url,
                method: 'GET',
                source: 'header',
                isVerified: verifyLinks ? this.isVerifiedDomain(url) : false
              });
            });
          }
        }

        // Check email body for unsubscribe links
        if (message.payload?.parts || message.payload?.body) {
          const bodyLinks = this.extractUnsubscribeLinksFromBody(message.payload);
          bodyLinks.forEach(link => unsubscribeLinks.push(link));
        }
      }

      // Remove duplicates
      const uniqueLinks = unsubscribeLinks.filter((link, index, array) => 
        array.findIndex(l => l.url === link.url) === index
      );

      operation.success = true;
      operation.count = uniqueLinks.length;
      this.logOperation(operation);

      return uniqueLinks;
    } catch (error) {
      operation.success = false;
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      this.logOperation(operation);
      throw new Error(`Failed to find unsubscribe links: ${error}`);
    }
  }

  private extractUrlsFromHeader(headerValue: string): string[] {
    const urls: string[] = [];
    const urlRegex = /<(https?:\/\/[^>]+)>/g;
    let match;
    
    while ((match = urlRegex.exec(headerValue)) !== null) {
      urls.push(match[1]);
    }
    
    return urls;
  }

  private extractUnsubscribeLinksFromBody(payload: any): UnsubscribeLink[] {
    const links: UnsubscribeLink[] = [];
    
    // This is a simplified implementation - in production, you'd want more sophisticated parsing
    // For now, we'll just return empty array as body parsing is complex
    return links;
  }

  private isVerifiedDomain(url: string): boolean {
    // Simple domain verification - in production, you'd want to check against known good domains
    try {
      const domain = new URL(url).hostname;
      const trustedDomains = ['gmail.com', 'google.com', 'mailchimp.com', 'constantcontact.com'];
      return trustedDomains.some(trusted => domain.includes(trusted));
    } catch {
      return false;
    }
  }

  async listLabels(includeSystemLabels: boolean = true, includeUserLabels: boolean = true): Promise<any[]> {
    await this.auth.refreshTokenIfNeeded();

    try {
      const response = await this.gmail.users.labels.list({
        userId: 'me'
      });

      let labels = response.data.labels || [];

      if (!includeSystemLabels) {
        labels = labels.filter((label: any) => label.type !== 'system');
      }

      if (!includeUserLabels) {
        labels = labels.filter((label: any) => label.type !== 'user');
      }

      return labels;
    } catch (error) {
      throw new Error(`Failed to list labels: ${error}`);
    }
  }

  getOperationLogs(): OperationLog[] {
    return [...this.operationLogs];
  }
} 