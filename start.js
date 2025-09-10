// Simple start script for Railway deployment
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting TourReviewAI Worker Service...');

// Start the main application
const child = spawn('node', ['dist/index.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PORT: process.env.PORT || '8080',
    HEALTH_PORT: process.env.HEALTH_PORT || process.env.PORT || '8080'
  }
});

child.on('error', (error) => {
  console.error('❌ Failed to start worker service:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`Worker service exited with code ${code}`);
  process.exit(code);
});

