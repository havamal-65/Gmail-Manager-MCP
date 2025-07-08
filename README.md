# Gmail MCP Server

A production-ready Model Context Protocol (MCP) server for Gmail management with bulk delete and unsubscribe capabilities.

## Features

- **Search Emails**: Query emails using Gmail's powerful search syntax
- **Count Emails**: Get counts of emails matching specific criteria
- **Delete Emails**: Safely delete emails with dry-run mode and confirmation
- **Email Details**: Get detailed information about specific emails
- **Unsubscribe Links**: Find unsubscribe links in promotional emails
- **List Labels**: View all Gmail labels and folders

## Safety Features

- **Dry-run mode** (enabled by default for deletions)
- **Confirmation requirements** for destructive operations
- **Operation logging** to track all actions
- **Rate limiting** with configurable deletion limits
- **Input validation** and comprehensive error handling

## Setup

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth2 credentials (Desktop application type)
5. Download the credentials as `credentials.json`
6. Place `credentials.json` in the project root directory

### 2. Installation

```bash
git clone <repository-url>
cd gmail-mcp-server
npm install
npm run build
```

### 3. Authentication

```bash
npm run auth
```

Follow the prompts to authenticate with your Gmail account.

## Usage

### As MCP Server

Start the server:
```bash
npm start
```

The server communicates via stdio using the MCP protocol. Connect it to your AI client (Claude, etc.) to use the Gmail tools.

### Available Tools

#### `search_emails`
Search emails using Gmail query syntax.

```json
{
  "name": "search_emails",
  "arguments": {
    "query": "from:newsletters OR from:marketing",
    "maxResults": 100,
    "includeSpamTrash": false
  }
}
```

#### `count_emails`
Count emails matching a query.

```json
{
  "name": "count_emails",
  "arguments": {
    "query": "older_than:1y",
    "includeSpamTrash": false
  }
}
```

#### `delete_emails`
Delete emails with safety checks.

```json
{
  "name": "delete_emails",
  "arguments": {
    "query": "from:spam@example.com",
    "dryRun": true,
    "maxDeletions": 50,
    "requireConfirmation": true
  }
}
```

#### `get_email_details`
Get detailed information about a specific email.

```json
{
  "name": "get_email_details",
  "arguments": {
    "messageId": "message_id_here",
    "includeHeaders": true,
    "includeBody": false
  }
}
```

#### `find_unsubscribe_links`
Find unsubscribe links in emails.

```json
{
  "name": "find_unsubscribe_links",
  "arguments": {
    "query": "from:promotional",
    "maxResults": 50,
    "verifyLinks": true
  }
}
```

#### `list_labels`
List all Gmail labels.

```json
{
  "name": "list_labels",
  "arguments": {
    "includeSystemLabels": true,
    "includeUserLabels": true
  }
}
```

## Gmail Search Syntax Examples

- `from:example@domain.com` - Emails from specific sender
- `subject:newsletter` - Emails with "newsletter" in subject
- `older_than:30d` - Emails older than 30 days
- `newer_than:1y` - Emails newer than 1 year
- `has:attachment` - Emails with attachments
- `in:spam` - Emails in spam folder
- `is:unread` - Unread emails
- `label:promotions` - Emails in promotions tab

## Safety Guidelines

1. **Always use dry-run mode first** when deleting emails
2. **Review the count** before actual deletion
3. **Start with small batches** (maxDeletions: 10-50)
4. **Check operation logs** in `email-operations.log`
5. **Be specific with queries** to avoid accidental deletions
6. **Test queries with search first** before using delete

## Configuration

### Environment Variables

- `GMAIL_CREDENTIALS_PATH`: Path to credentials.json (default: ./credentials.json)
- `GMAIL_TOKEN_PATH`: Path to token.json (default: ./token.json)
- `GMAIL_LOG_FILE`: Path to operation log file (default: ./email-operations.log)

### Security Notes

- This server uses your personal Gmail credentials
- All operations are logged for audit purposes
- Tokens are stored locally in `token.json`
- Never share your credentials or tokens
- Use only for personal Gmail accounts

## Development

### Build
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Watch Mode
```bash
npm run watch
```

### Re-authenticate
```bash
npm run auth
```

## Troubleshooting

### Authentication Issues
1. Ensure credentials.json is in the correct location
2. Check that the OAuth app is in "Testing" mode
3. Add yourself as a test user in Google Cloud Console
4. Verify redirect URI is set to `http://localhost`

### Permission Errors
1. Check that Gmail API is enabled in Google Cloud Console
2. Verify OAuth consent screen is configured
3. Ensure you're using the correct OAuth client type (Desktop Application)

### Rate Limiting
The server includes built-in rate limiting to respect Gmail API quotas. If you encounter rate limit errors, wait a few minutes before retrying.

## License

MIT - See LICENSE file for details.

## Security

This is intended for personal use only. Do not use with shared or organizational Gmail accounts without proper security review. 