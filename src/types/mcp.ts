export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface SearchEmailsArgs {
  query: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
}

export interface DeleteEmailsArgs {
  query: string;
  dryRun?: boolean;
  maxDeletions?: number;
  requireConfirmation?: boolean;
  includeSpamTrash?: boolean;
}

export interface PreviewEmailsForDeletionArgs {
  query: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
  showFullHeaders?: boolean;
}

export interface GetEmailDetailsArgs {
  messageId: string;
  includeHeaders?: boolean;
  includeBody?: boolean;
}

export interface FindUnsubscribeLinksArgs {
  query: string;
  maxResults?: number;
  verifyLinks?: boolean;
}

export interface CountEmailsArgs {
  query: string;
  includeSpamTrash?: boolean;
}

export interface ListLabelsArgs {
  includeSystemLabels?: boolean;
  includeUserLabels?: boolean;
} 