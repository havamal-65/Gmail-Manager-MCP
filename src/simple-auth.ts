#!/usr/bin/env node

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import * as readline from 'readline';

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

async function authenticateGmail() {
  console.log('🔐 Gmail Authentication Setup');
  console.log('============================');

  // Check if credentials.json exists
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error('❌ credentials.json not found!');
    console.log('📥 Please download credentials.json from Google Cloud Console and place it in this folder.');
    process.exit(1);
  }

  // Check if already authenticated
  if (existsSync(TOKEN_PATH)) {
    console.log('✅ Already authenticated! Checking if token is valid...');
    try {
      const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
      console.log('✅ Authentication token found and loaded.');
      console.log('🚀 You can now run: npm run dev');
      return;
    } catch (error) {
      console.log('⚠️  Existing token is invalid, re-authenticating...');
    }
  }

  // Load credentials
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Generate auth URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n🌐 Opening your browser for authentication...');
  console.log('URL:', authUrl);
  
  // Try to open the browser automatically
  const platform = process.platform;
  const command = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
  
  exec(`${command} "${authUrl}"`, (error) => {
    if (error) {
      console.log('⚠️  Could not open browser automatically.');
      console.log('📋 Please manually open this URL in your browser:');
      console.log(authUrl);
    }
  });

  console.log('\n📝 After completing authorization in your browser:');
  console.log('1. You\'ll see "This app isn\'t verified" - click "Advanced"');
  console.log('2. Click "Go to gmail-mcp-server (unsafe)" - this is safe since you created it');
  console.log('3. Complete the authorization');
  console.log('4. You\'ll get "localhost refused to connect" - THIS IS NORMAL!');
  console.log('5. In the browser address bar, you\'ll see a URL like:');
  console.log('   http://localhost/?code=4/XXXXXXXXXX&scope=...');
  console.log('6. Copy ONLY the code part (after "code=" and before "&scope")');
  console.log('7. Paste it below');

  // Get authorization code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\n🔑 Enter the authorization code from the URL: ', async (code) => {
    rl.close();
    
    try {
      // Clean the code in case user copied extra parts
      const cleanCode = code.trim().split('&')[0];
      
      const { tokens } = await oAuth2Client.getToken(cleanCode);
      oAuth2Client.setCredentials(tokens);

      // Save the token
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('\n✅ Authentication successful!');
      console.log('🔐 Token saved to token.json');
      console.log('🚀 You can now run: npm run dev');
      
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      console.log('\n💡 Make sure you copied only the authorization code (the part after "code=")');
      console.log('💡 Please try again with: npm run auth');
    }
  });
}

authenticateGmail().catch(console.error); 