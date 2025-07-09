import { gmail_v1, google } from 'googleapis';
import { GmailAuth } from './auth/gmail-auth';
import { appendFileSync } from 'fs';

// Enhanced batch processing limits based on MCP guide
const MAX_BATCH_SIZE = 50; // Reduced from 100 to comply with MCP recommendations
const MAX_CONCURRENT_BATCHES = 3;
const RATE_LIMIT_DELAY = 2000; // 2 seconds between batches for rate limiting
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE = 1000; // Base delay for exponential backoff

export interface EmailSearchResult {
  messages: EmailMessage[];
  totalResults: number;
  nextPageToken?: string;
}

export interface EmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: any;
}

export interface EmailDeletionResult {
  deletedCount: number;
  failedCount: number;
  errors: string[];
  confirmationToken?: string;
}

export interface UnsubscribeLink {
  url: string;
  method: 'GET' | 'POST';
  source: 'header' | 'body';
  isVerified: boolean;
}

export interface OperationLog {
  timestamp: string;
  operation: string;
  query?: string;
  count?: number;
  dryRun: boolean;
  success: boolean;
  error?: string;
  confirmationToken?: string;
}

export class GmailClient {
  private auth: GmailAuth;
  private gmail: gmail_v1.Gmail;
  private operationLogs: OperationLog[] = [];
  private readonly LOG_FILE = 'email-operations.log';
  private confirmationTokens: Map<string, { query: string; messageIds: string[]; expires: number }> = new Map();

  constructor() {
    this.auth = new GmailAuth();
    this.gmail = google.gmail({ version: 'v1' });
  }

  async initialize(): Promise<void> {
    const authClient = await this.auth.authenticate();
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
    
    // Verify delete permissions
    const hasDeletePermissions = await this.auth.verifyDeletePermissions();
    if (!hasDeletePermissions) {
      throw new Error('Insufficient permissions for email deletion. Please re-authenticate with proper scopes.');
    }
  }

  private logOperation(operation: OperationLog): void {
    this.operationLogs.push(operation);
    const logEntry = JSON.stringify(operation) + '\n';
    appendFileSync(this.LOG_FILE, logEntry);
  }

  private generateConfirmationToken(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = MAX_RETRY_ATTEMPTS
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a rate limit error
        if ((error as any).code === 429 || (error as any).message?.includes('Rate limit')) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
          console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.sleep(delay);
          continue;
        }
        
        // Check if it's a retryable error
        if ((error as any).code >= 500 && (error as any).code < 600) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
          console.log(`Server error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.sleep(delay);
          continue;
        }
        
        // Non-retryable error, throw immediately
        throw error;
      }
    }
    
    throw lastError;
  }

  async searchEmails(query: string, maxResults: number = 100, includeSpamTrash: boolean = false): Promise<EmailSearchResult> {
    await this.auth.refreshTokenIfNeeded();

    try {
      const searchQuery = includeSpamTrash ? query : `${query} -in:spam -in:trash`;
      
      const response = await this.retryWithBackoff(() => 
        this.gmail.users.messages.list({
          userId: 'me',
          q: searchQuery,
          maxResults: Math.min(maxResults, 500)
        })
      );

      const messages = response.data.messages || [];
      const totalResults = response.data.resultSizeEstimate || 0;

      if (messages.length === 0) {
        return { messages: [], totalResults: 0 };
      }

      // Get full message details in batches
      const detailedMessages: EmailMessage[] = [];
      const batchSize = 50;
      
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        
        const batchPromises = batch.map(msg => 
          this.retryWithBackoff(() =>
            this.gmail.users.messages.get({
              userId: 'me',
              id: msg.id!,
              format: 'metadata'
            })
          )
        );

        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            detailedMessages.push({
              id: result.value.data.id!,
              threadId: result.value.data.threadId || undefined,
              snippet: result.value.data.snippet || undefined,
              internalDate: result.value.data.internalDate || undefined,
              payload: result.value.data.payload
            });
          }
        });

        // Rate limiting between batches
        if (i + batchSize < messages.length) {
          await this.sleep(RATE_LIMIT_DELAY);
        }
      }

             return {
         messages: detailedMessages,
         totalResults,
         nextPageToken: response.data.nextPageToken || undefined
       };
    } catch (error) {
      throw new Error(`Failed to search emails: ${error}`);
    }
  }

  async countEmails(query: string, includeSpamTrash: boolean = false): Promise<number> {
    await this.auth.refreshTokenIfNeeded();

    try {
      const searchQuery = includeSpamTrash ? query : `${query} -in:spam -in:trash`;
      
      const response = await this.retryWithBackoff(() =>
        this.gmail.users.messages.list({
          userId: 'me',
          q: searchQuery,
          maxResults: 1
        })
      );

      return response.data.resultSizeEstimate || 0;
    } catch (error) {
      throw new Error(`Failed to count emails: ${error}`);
    }
  }

  // Enhanced delete with confirmation tokens and proper batch processing
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
      const searchResult = await this.searchEmails(query, maxDeletions + 1);
      const messageIds = searchResult.messages.map(msg => msg.id);

      // Safety check - limit deletions
      if (messageIds.length > maxDeletions) {
        throw new Error(`Too many emails to delete (${messageIds.length}). Maximum allowed: ${maxDeletions}`);
      }

      if (dryRun) {
        // Generate confirmation token for actual deletion
        const confirmationToken = this.generateConfirmationToken();
        this.confirmationTokens.set(confirmationToken, {
          query,
          messageIds,
          expires: Date.now() + 300000 // 5 minutes
        });

        operation.success = true;
        operation.count = messageIds.length;
        operation.confirmationToken = confirmationToken;
        this.logOperation(operation);
        
        return { 
          deletedCount: 0, 
          failedCount: 0, 
          errors: [`DRY RUN: Would delete ${messageIds.length} emails`],
          confirmationToken
        };
      }

      // Enhanced batch processing with proper limits
      const results = await this.processBatchDeletion(messageIds);
      
      operation.success = results.failedCount === 0;
      operation.count = results.deletedCount;
      this.logOperation(operation);

      return results;
    } catch (error) {
      operation.success = false;
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      this.logOperation(operation);
      throw new Error(`Failed to delete emails: ${error}`);
    }
  }

  async confirmAndDeleteEmails(confirmationToken: string): Promise<EmailDeletionResult> {
    const tokenData = this.confirmationTokens.get(confirmationToken);
    
    if (!tokenData) {
      throw new Error('Invalid or expired confirmation token');
    }
    
    if (Date.now() > tokenData.expires) {
      this.confirmationTokens.delete(confirmationToken);
      throw new Error('Confirmation token has expired');
    }

    try {
      const results = await this.processBatchDeletion(tokenData.messageIds);
      this.confirmationTokens.delete(confirmationToken);
      return results;
    } catch (error) {
      this.confirmationTokens.delete(confirmationToken);
      throw error;
    }
  }

  private async processBatchDeletion(messageIds: string[]): Promise<EmailDeletionResult> {
    let deletedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Process in batches of MAX_BATCH_SIZE (50) emails
    for (let i = 0; i < messageIds.length; i += MAX_BATCH_SIZE) {
      const batch = messageIds.slice(i, i + MAX_BATCH_SIZE);
      
      try {
        await this.retryWithBackoff(() =>
          this.gmail.users.messages.batchDelete({
            userId: 'me',
            requestBody: {
              ids: batch
            }
          })
        );
        
        deletedCount += batch.length;
        console.log(`Successfully deleted batch of ${batch.length} emails`);
        
      } catch (error) {
        failedCount += batch.length;
        const errorMsg = `Failed to delete batch of ${batch.length} emails: ${error}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }

      // Enhanced rate limiting between batches
      if (i + MAX_BATCH_SIZE < messageIds.length) {
        await this.sleep(RATE_LIMIT_DELAY);
      }
    }

    return { deletedCount, failedCount, errors };
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
        id: response.data.id!,
        threadId: response.data.threadId || undefined,
        snippet: response.data.snippet || undefined,
        internalDate: response.data.internalDate || undefined,
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
          const unsubscribeHeader = message.payload.headers.find((h: any) => 
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