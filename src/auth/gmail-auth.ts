import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

export class GmailAuth {
  private oauth2Client: OAuth2Client | null = null;
  
  constructor() {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    try {
      if (!existsSync(CREDENTIALS_PATH)) {
        throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}`);
      }

      const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
      const { client_secret, client_id, redirect_uris } = credentials.installed;
      
      this.oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Load existing token if available
      if (existsSync(TOKEN_PATH)) {
        const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
        this.oauth2Client.setCredentials(token);
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
      throw error;
    }
  }

  async authenticate(): Promise<OAuth2Client> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    // Check if we have a valid token
    if (this.oauth2Client.credentials.access_token) {
      try {
        // Verify token is still valid
        await this.oauth2Client.getAccessToken();
        return this.oauth2Client;
      } catch (error) {
        console.log('Token expired, need to refresh or reauthorize');
      }
    }

    // Need to authorize
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('\n🔐 GMAIL AUTHENTICATION REQUIRED');
    console.log('===============================');
    console.log('1. Open this URL in your browser:');
    console.log(authUrl);
    console.log('\n2. Complete the authorization');
    console.log('3. You will see "This app isn\'t verified" - this is normal for personal use');
    console.log('4. Click "Advanced" then "Go to gmail-mcp-server (unsafe)" - this is safe since you created the app');
    console.log('5. Copy the authorization code and paste it here');
    console.log('\n⚠️  The app will appear "unverified" - this is expected and safe for personal use');
    
    // In a real implementation, you'd want to use a more sophisticated input method
    // For now, we'll throw an error with instructions
    throw new Error('Manual authorization required. Please run the server and follow the authentication flow.');
  }

  async handleAuthCode(code: string): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      // Save token for future use
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('✅ Authentication successful! Token saved.');
    } catch (error) {
      console.error('❌ Error during authentication:', error);
      throw error;
    }
  }

  getAuthenticatedClient(): OAuth2Client {
    if (!this.oauth2Client || !this.oauth2Client.credentials.access_token) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    return this.oauth2Client;
  }

  isAuthenticated(): boolean {
    return !!(this.oauth2Client && this.oauth2Client.credentials.access_token);
  }

  async refreshTokenIfNeeded(): Promise<void> {
    if (!this.oauth2Client) return;

    try {
      await this.oauth2Client.getAccessToken();
    } catch (error) {
      console.log('Token refresh failed, re-authentication required');
      throw new Error('Token refresh failed. Please re-authenticate.');
    }
  }
} 