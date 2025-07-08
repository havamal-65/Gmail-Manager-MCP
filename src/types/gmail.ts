export interface EmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload?: {
    headers: EmailHeader[];
    body?: {
      data?: string;
      attachmentId?: string;
      size: number;
    };
    parts?: EmailPart[];
  };
}

export interface EmailHeader {
  name: string;
  value: string;
}

export interface EmailPart {
  mimeType: string;
  filename?: string;
  headers: EmailHeader[];
  body?: {
    data?: string;
    attachmentId?: string;
    size: number;
  };
  parts?: EmailPart[];
}

export interface EmailSearchResult {
  messages: EmailMessage[];
  totalResults: number;
  nextPageToken?: string;
}

export interface UnsubscribeLink {
  url: string;
  method: 'GET' | 'POST';
  source: 'header' | 'body';
  isVerified: boolean;
}

export interface EmailDeletionResult {
  deletedCount: number;
  failedCount: number;
  errors: string[];
}

export interface EmailStats {
  totalEmails: number;
  fromLastWeek: number;
  fromLastMonth: number;
  fromLastYear: number;
  byLabel: Record<string, number>;
}

export interface OperationLog {
  timestamp: string;
  operation: 'search' | 'delete' | 'unsubscribe' | 'count';
  query?: string;
  count?: number;
  dryRun: boolean;
  success: boolean;
  error?: string;
} 