#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { GmailClient } from './gmail-client.js';
import { 
  ToolResult,
  SearchEmailsArgs,
  DeleteEmailsArgs,
  GetEmailDetailsArgs,
  FindUnsubscribeLinksArgs,
  CountEmailsArgs,
  ListLabelsArgs,
  PreviewEmailsForDeletionArgs
} from './types/mcp.js';

class GmailMCPServer {
  private server: Server;
  private gmailClient: GmailClient;

  constructor() {
    this.server = new Server(
      {
        name: 'gmail-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.gmailClient = new GmailClient();
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_emails',
            description: 'Search for emails using Gmail query syntax',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Gmail search query (e.g., "from:example.com", "subject:newsletter", "is:unread older_than:30d")'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 100, max: 500)',
                  default: 100
                },
                includeSpamTrash: {
                  type: 'boolean',
                  description: 'Whether to include emails in spam and trash folders (default: false)',
                  default: false
                }
              },
              required: ['query']
            }
          },
          {
            name: 'count_emails',
            description: 'Count emails matching a query - provides exact count by actually searching',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Gmail search query'
                },
                includeSpamTrash: {
                  type: 'boolean',
                  description: 'Whether to include emails in spam and trash folders (default: false)',
                  default: false
                }
              },
              required: ['query']
            }
          },
          {
            name: 'preview_emails_for_deletion',
            description: 'Preview emails that would be deleted with full details - USE THIS BEFORE delete_emails',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Gmail search query for emails to preview'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of emails to preview (default: 50, max: 200)',
                  default: 50
                },
                includeSpamTrash: {
                  type: 'boolean',
                  description: 'Whether to include emails in spam and trash folders (default: false)',
                  default: false
                },
                showFullHeaders: {
                  type: 'boolean',
                  description: 'Whether to show full email headers (default: false)',
                  default: false
                }
              },
              required: ['query']
            }
          },
          {
            name: 'delete_emails',
            description: 'Delete emails matching a query - ALWAYS use preview_emails_for_deletion first!',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Gmail search query for emails to delete'
                },
                dryRun: {
                  type: 'boolean',
                  description: 'If true, shows what would be deleted without actually deleting (default: true)',
                  default: true
                },
                maxDeletions: {
                  type: 'number',
                  description: 'Maximum number of emails to delete in one operation (default: 100)',
                  default: 100
                },
                requireConfirmation: {
                  type: 'boolean',
                  description: 'Require explicit confirmation before deletion (default: true)',
                  default: true
                },
                includeSpamTrash: {
                  type: 'boolean',
                  description: 'Whether to include emails in spam and trash folders (default: false)',
                  default: false
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_email_details',
            description: 'Get detailed information about a specific email',
            inputSchema: {
              type: 'object',
              properties: {
                messageId: {
                  type: 'string',
                  description: 'Gmail message ID'
                },
                includeHeaders: {
                  type: 'boolean',
                  description: 'Whether to include email headers (default: true)',
                  default: true
                },
                includeBody: {
                  type: 'boolean',
                  description: 'Whether to include email body content (default: false)',
                  default: false
                }
              },
              required: ['messageId']
            }
          },
          {
            name: 'find_unsubscribe_links',
            description: 'Find unsubscribe links in emails matching a query',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Gmail search query to find emails with unsubscribe links'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of emails to scan for unsubscribe links (default: 50)',
                  default: 50
                },
                verifyLinks: {
                  type: 'boolean',
                  description: 'Whether to verify if links are from trusted domains (default: true)',
                  default: true
                }
              },
              required: ['query']
            }
          },
          {
            name: 'list_labels',
            description: 'List all Gmail labels/folders',
            inputSchema: {
              type: 'object',
              properties: {
                includeSystemLabels: {
                  type: 'boolean',
                  description: 'Whether to include system labels like INBOX, SENT, etc. (default: true)',
                  default: true
                },
                includeUserLabels: {
                  type: 'boolean',
                  description: 'Whether to include user-created labels (default: true)',
                  default: true
                }
              }
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_emails':
            return await this.handleSearchEmails(args as unknown as SearchEmailsArgs);
          case 'count_emails':
            return await this.handleCountEmails(args as unknown as CountEmailsArgs);
          case 'preview_emails_for_deletion':
            return await this.handlePreviewEmailsForDeletion(args as unknown as PreviewEmailsForDeletionArgs);
          case 'delete_emails':
            return await this.handleDeleteEmails(args as unknown as DeleteEmailsArgs);
          case 'get_email_details':
            return await this.handleGetEmailDetails(args as unknown as GetEmailDetailsArgs);
          case 'find_unsubscribe_links':
            return await this.handleFindUnsubscribeLinks(args as unknown as FindUnsubscribeLinksArgs);
          case 'list_labels':
            return await this.handleListLabels(args as unknown as ListLabelsArgs);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
      }
    });
  }

  private async handleSearchEmails(args: SearchEmailsArgs) {
    const { query, maxResults = 100, includeSpamTrash = false } = args;
    
    try {
      const result = await this.gmailClient.searchEmails(query, maxResults, includeSpamTrash);
      
      const summary = `Found ${result.messages.length} emails (estimated total: ${result.totalResults})`;
      const emailList = result.messages.map(email => 
        `ID: ${email.id} | Date: ${new Date(parseInt(email.internalDate || '0')).toLocaleDateString()} | Snippet: ${email.snippet?.substring(0, 100)}...`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `${summary}\n\n${emailList}`
        }]
      } as any;
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error searching emails: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handlePreviewEmailsForDeletion(args: PreviewEmailsForDeletionArgs): Promise<ToolResult> {
    const { query, maxResults = 50, includeSpamTrash = false, showFullHeaders = false } = args;
    
    try {
      const result = await this.gmailClient.searchEmails(query, maxResults, includeSpamTrash);
      
      if (result.messages.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No emails found matching query: "${query}"`
          }]
        };
      }

      let preview = `📧 DELETION PREVIEW - ${result.messages.length} emails would be deleted\n`;
      preview += `Query: "${query}"\n`;
      preview += `Estimated total matching emails: ${result.totalResults}\n`;
      preview += `======================================\n\n`;

      for (let i = 0; i < result.messages.length; i++) {
        const email = result.messages[i];
        const date = new Date(parseInt(email.internalDate || '0')).toLocaleString();
        
        // Get basic headers
        const headers = email.payload?.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No subject)';
        const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '(Unknown sender)';
        const to = headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || '(Unknown recipient)';
        
        preview += `${i + 1}. EMAIL ID: ${email.id}\n`;
        preview += `   📅 Date: ${date}\n`;
        preview += `   👤 From: ${from}\n`;
        preview += `   📧 To: ${to}\n`;
        preview += `   📝 Subject: ${subject}\n`;
        preview += `   💬 Snippet: ${email.snippet || '(No preview available)'}\n`;
        
        if (showFullHeaders) {
          preview += `   📋 Headers:\n`;
          headers.forEach((header: any) => {
            preview += `      ${header.name}: ${header.value}\n`;
          });
        }
        
        preview += `\n`;
      }

      if (result.totalResults > maxResults) {
        preview += `⚠️  WARNING: Only showing first ${maxResults} emails, but ${result.totalResults} total emails match this query.\n`;
        preview += `Consider refining your query or increasing maxResults to see more.\n\n`;
      }

      preview += `🔴 IMPORTANT: If you proceed with deletion, these ${result.messages.length} emails will be PERMANENTLY deleted!\n`;
      preview += `🔍 To delete these emails, use the 'delete_emails' tool with the same query.\n`;
      preview += `🛡️  Always run this preview before any deletion to ensure you're not deleting important emails.`;

      return {
        content: [{
          type: 'text',
          text: preview
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error previewing emails: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handleCountEmails(args: CountEmailsArgs): Promise<ToolResult> {
    const { query, includeSpamTrash = false } = args;
    
    try {
      // Get exact count by actually searching
      const result = await this.gmailClient.searchEmails(query, 1, includeSpamTrash);
      const exactCount = result.totalResults;
      
      return {
        content: [{
          type: 'text',
          text: `📊 Found exactly ${exactCount} emails matching query: "${query}"\n\n` +
                `🔍 To see what emails would be affected, use 'preview_emails_for_deletion' with the same query.\n` +
                `⚠️  This count includes all emails matching the query, not just the first batch.`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error counting emails: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handleDeleteEmails(args: DeleteEmailsArgs): Promise<ToolResult> {
    const { query, dryRun = true, maxDeletions = 100, requireConfirmation = true, includeSpamTrash = false } = args;
    
    try {
      // Get exact count first
      const searchResult = await this.gmailClient.searchEmails(query, maxDeletions + 1, includeSpamTrash);
      const exactCount = searchResult.totalResults;
      
      if (exactCount === 0) {
        return {
          content: [{
            type: 'text',
            text: `No emails found matching query: "${query}"`
          }]
        };
      }

      // Safety check: Too many emails
      if (exactCount > maxDeletions) {
        return {
          content: [{
            type: 'text',
            text: `🚨 SAFETY CHECK FAILED: Found ${exactCount} emails, but maximum deletion limit is ${maxDeletions}.\n\n` +
                  `This prevents accidental bulk deletion of large numbers of emails.\n\n` +
                  `Options:\n` +
                  `1. Refine your query to match fewer emails\n` +
                  `2. Use 'preview_emails_for_deletion' to see what would be deleted\n` +
                  `3. Increase maxDeletions parameter if you're sure (up to 500)\n\n` +
                  `⚠️  Remember: Deleted emails cannot be recovered!`
          }],
          isError: true
        };
      }

      // Require confirmation for actual deletion
      if (!dryRun && requireConfirmation) {
        const previewEmails = searchResult.messages.slice(0, 5);
        let confirmationMsg = `🔴 DELETION CONFIRMATION REQUIRED\n\n`;
        confirmationMsg += `You are about to PERMANENTLY delete ${exactCount} emails matching: "${query}"\n\n`;
        confirmationMsg += `📋 Preview of first ${Math.min(5, exactCount)} emails:\n`;
        
        previewEmails.forEach((email, i) => {
          const headers = email.payload?.headers || [];
          const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No subject)';
          const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '(Unknown sender)';
          const date = new Date(parseInt(email.internalDate || '0')).toLocaleDateString();
          
          confirmationMsg += `${i + 1}. ${subject} - From: ${from} (${date})\n`;
        });
        
        if (exactCount > 5) {
          confirmationMsg += `... and ${exactCount - 5} more emails\n`;
        }
        
        confirmationMsg += `\n⚠️  THIS ACTION CANNOT BE UNDONE!\n\n`;
        confirmationMsg += `If you're absolutely sure, run this command again with requireConfirmation: false`;
        
        return {
          content: [{
            type: 'text',
            text: confirmationMsg
          }],
          isError: true
        };
      }

      const result = await this.gmailClient.deleteEmails(query, dryRun, maxDeletions);
      
      if (dryRun) {
        let dryRunMsg = `🧪 DRY RUN COMPLETE - No emails were actually deleted\n\n`;
        dryRunMsg += `📊 Would delete ${exactCount} emails matching: "${query}"\n\n`;
        dryRunMsg += `🔍 Use 'preview_emails_for_deletion' to see exactly which emails would be deleted.\n`;
        dryRunMsg += `🔴 To actually delete these emails, run with dryRun: false`;
        
        return {
          content: [{
            type: 'text',
            text: dryRunMsg
          }]
        };
      }

      // Real deletion results
      let resultMsg = `✅ EMAIL DELETION COMPLETED\n\n`;
      resultMsg += `📊 Successfully deleted: ${result.deletedCount} emails\n`;
      
      if (result.failedCount > 0) {
        resultMsg += `❌ Failed to delete: ${result.failedCount} emails\n`;
      }
      
      if (result.errors.length > 0) {
        resultMsg += `\n🚨 Errors encountered:\n`;
        result.errors.forEach(error => {
          resultMsg += `   • ${error}\n`;
        });
      }
      
      resultMsg += `\n🗑️  These emails have been permanently deleted and cannot be recovered.`;

      return {
        content: [{
          type: 'text',
          text: resultMsg
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error deleting emails: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handleGetEmailDetails(args: GetEmailDetailsArgs): Promise<ToolResult> {
    const { messageId, includeHeaders = true, includeBody = false } = args;
    
    try {
      const email = await this.gmailClient.getEmailDetails(messageId, includeHeaders, includeBody);
      
      let details = `Email ID: ${email.id}\n`;
      details += `Thread ID: ${email.threadId}\n`;
      details += `Date: ${new Date(parseInt(email.internalDate || '0')).toLocaleString()}\n`;
      details += `Snippet: ${email.snippet}\n`;

      if (includeHeaders && email.payload?.headers) {
        details += `Headers:\n`;
        email.payload.headers.forEach((header: any) => {
          details += `  ${header.name}: ${header.value}\n`;
        });
      }

      return {
        content: [{
          type: 'text',
          text: details
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error getting email details: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handleFindUnsubscribeLinks(args: FindUnsubscribeLinksArgs): Promise<ToolResult> {
    const { query, maxResults = 50, verifyLinks = true } = args;
    
    try {
      const links = await this.gmailClient.findUnsubscribeLinks(query, maxResults, verifyLinks);
      
      if (links.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No unsubscribe links found in emails matching query: "${query}"`
          }]
        };
      }

      let result = `Found ${links.length} unsubscribe links:\n\n`;
      links.forEach((link, index) => {
        result += `${index + 1}. ${link.url}\n`;
        result += `   Source: ${link.source}\n`;
        result += `   Method: ${link.method}\n`;
        result += `   Verified: ${link.isVerified ? '✅' : '❌'}\n\n`;
      });

      result += '\n⚠️  SECURITY WARNING: Only click unsubscribe links from trusted senders. Malicious links can confirm your email address to spammers.';

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error finding unsubscribe links: ${error}`
        }],
        isError: true
      };
    }
  }

  private async handleListLabels(args: ListLabelsArgs): Promise<ToolResult> {
    const { includeSystemLabels = true, includeUserLabels = true } = args;
    
    try {
      const labels = await this.gmailClient.listLabels(includeSystemLabels, includeUserLabels);
      
      if (labels.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No labels found'
          }]
        };
      }

      let result = `Found ${labels.length} labels:\n\n`;
      labels.forEach(label => {
        result += `• ${label.name} (${label.type})\n`;
        if (label.messagesTotal !== undefined) {
          result += `  Messages: ${label.messagesTotal}\n`;
        }
      });

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error listing labels: ${error}`
        }],
        isError: true
      };
    }
  }

  async run(): Promise<void> {
    try {
      // Initialize Gmail client
      await this.gmailClient.initialize();
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      // MCP server is now running and ready to handle requests
      
    } catch (error) {
      console.error('❌ Failed to start Gmail MCP Server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new GmailMCPServer();
server.run().catch(console.error); 