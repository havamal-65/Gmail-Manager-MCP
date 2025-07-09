import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

// Enhanced scopes for proper delete permissions
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly'
];

const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export class GmailAuth {
  private oauth2Client: OAuth2Client | null = null;
  private pkceChallenge: PKCEChallenge | null = null;
  
  constructor() {
    this.initializeAuth();
  }

  private generatePKCEChallenge(): PKCEChallenge {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    
    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256'
    };
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
      throw new Error(`Failed to initialize Gmail authentication: ${error}`);
    }
  }

  async authenticate(): Promise<OAuth2Client> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    // Check if we have a valid token
    if (this.oauth2Client.credentials.access_token) {
      try {
        // Verify token is still valid and has sufficient scopes
        await this.oauth2Client.getAccessToken();
        
        // Verify we have delete permissions
        const tokenInfo = await this.oauth2Client.getTokenInfo(
          this.oauth2Client.credentials.access_token
        );
        
        const hasModifyScope = tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.modify');
        if (!hasModifyScope) {
          throw new Error('Token does not have gmail.modify scope required for deletion');
        }
        
        return this.oauth2Client;
      } catch (error) {
        console.log('Token expired or insufficient permissions, need to refresh or reauthorize');
        // Clear existing credentials to force re-authorization
        this.oauth2Client.setCredentials({});
      }
    }

    // Generate PKCE challenge for OAuth 2.1 compliance
    this.pkceChallenge = this.generatePKCEChallenge();

    // Enhanced OAuth 2.1 authorization URL with PKCE
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to ensure we get refresh token
      code_challenge: this.pkceChallenge.codeChallenge,
      code_challenge_method: 'S256' as any,
      include_granted_scopes: true
    });

    console.log('\n🔐 GMAIL AUTHENTICATION REQUIRED');
    console.log('===============================');
    console.log('Enhanced OAuth 2.1 with PKCE for secure delete permissions');
    console.log('\n1. Open this URL in your browser:');
    console.log(authUrl);
    console.log('\n2. Complete the authorization');
    console.log('3. Grant permissions for Gmail modification (required for email deletion)');
    console.log('4. You will see "This app isn\'t verified" - this is normal for personal use');
    console.log('5. Click "Advanced" then "Go to gmail-mcp-server (unsafe)" - this is safe since you created the app');
    console.log('6. Copy the authorization code and paste it here');
    console.log('\n⚠️  The app will appear "unverified" - this is expected and safe for personal use');
    console.log('🔒 OAuth 2.1 with PKCE ensures secure authentication');
    
    throw new Error('Manual authorization required. Please run the server and follow the authentication flow.');
  }

  async handleAuthCode(code: string): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    if (!this.pkceChallenge) {
      throw new Error('PKCE challenge not generated. Call authenticate() first.');
    }

    try {
      // Exchange authorization code for tokens with PKCE verification
      const { tokens } = await this.oauth2Client.getToken({
        code,
        codeVerifier: this.pkceChallenge.codeVerifier
      });
      
      this.oauth2Client.setCredentials(tokens);
      
      // Verify we have the required scopes
      if (tokens.access_token) {
        const tokenInfo = await this.oauth2Client.getTokenInfo(tokens.access_token);
        const hasModifyScope = tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.modify');
        
        if (!hasModifyScope) {
          throw new Error('Authorization successful but missing gmail.modify scope required for deletion');
        }
      }
      
      // Save token for future use
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('✅ Authentication successful! Token saved with delete permissions.');
      
      // Clear PKCE challenge
      this.pkceChallenge = null;
      
    } catch (error) {
      console.error('❌ Error during authentication:', error);
      this.pkceChallenge = null;
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
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      
      // Update stored token
      writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
      
    } catch (error) {
      console.log('Token refresh failed, re-authentication required');
      // Clear credentials to force re-authentication
      this.oauth2Client.setCredentials({});
      throw new Error('Token refresh failed. Please re-authenticate with proper delete permissions.');
    }
  }

  async verifyDeletePermissions(): Promise<boolean> {
    if (!this.oauth2Client?.credentials.access_token) {
      return false;
    }

    try {
      const tokenInfo = await this.oauth2Client.getTokenInfo(
        this.oauth2Client.credentials.access_token
      );
      
      return tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.modify') || false;
    } catch (error) {
      console.log('Error verifying delete permissions:', error);
      return false;
    }
  }
} 