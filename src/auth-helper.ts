#!/usr/bin/env node

import { GmailAuth } from './auth/gmail-auth.js';
// Simple authentication helper

async function authenticateUser() {
  console.log('🔐 Gmail MCP Server Authentication Helper');
  console.log('=========================================');
  
  const auth = new GmailAuth();
  
  try {
    // This will show the authorization URL
    await auth.authenticate();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Manual authorization required')) {
      console.log('\n📝 After completing authorization in your browser:');
      const code = prompt('Enter the authorization code: ');
      
      if (!code) {
        console.log('❌ No authorization code provided');
        process.exit(1);
      }
      
      try {
        await auth.handleAuthCode(code);
        console.log('✅ Authentication successful!');
        console.log('🚀 You can now run: npm run dev');
      } catch (authError) {
        console.error('❌ Authentication failed:', authError);
        process.exit(1);
      }
    } else {
      console.error('❌ Authentication error:', error);
      process.exit(1);
    }
  }
}

// Simple prompt function for Node.js
function prompt(question: string): string | null {
  process.stdout.write(question);
  process.stdin.setEncoding('utf8');
  
  let input = '';
  const fd = process.stdin.fd;
  
  while (true) {
    const buffer = Buffer.alloc(1);
    const bytesRead = require('fs').readSync(fd, buffer, 0, 1);
    
    if (bytesRead === 0) {
      break;
    }
    
    const char = buffer.toString('utf8');
    
    if (char === '\n' || char === '\r') {
      break;
    }
    
    input += char;
    process.stdout.write(char);
  }
  
  process.stdout.write('\n');
  return input.trim() || null;
}

authenticateUser().catch(console.error); 