#!/usr/bin/env node

/**
 * Generate a secure random API key
 *
 * Usage:
 *   node scripts/generate-secret.js
 *   node scripts/generate-secret.js 32
 */

const crypto = require("crypto");

// Get length from command line argument or use default
const length = parseInt(process.argv[2]) || 32;

// Validate length
if (length < 16) {
  console.error(
    "❌ Error: API key length must be at least 16 bytes for security",
  );
  process.exit(1);
}

if (length > 256) {
  console.error("❌ Error: API key length cannot exceed 256 bytes");
  process.exit(1);
}

// Generate random bytes and convert to hex
const apiKey = crypto.randomBytes(length).toString("hex");

console.log("🔑 API Key Generated\n");
console.log("Length:", length * 2, "characters");
console.log("API Key:", apiKey);
console.log("\n📋 Copy this to your .env file:");
console.log(`API_KEY=${apiKey}`);
console.log("\n💡 For production, set this as a Fly.io secret:");
console.log(`fly secrets set API_KEY="${apiKey}"`);
console.log("\n📝 Use this API key in your requests:");
console.log("Option 1 - Authorization header:");
console.log(
  `  curl -H "Authorization: Bearer ${apiKey}" https://your-app.fly.dev/api/users`,
);
console.log("Option 2 - x-api-key header:");
console.log(
  `  curl -H "x-api-key: ${apiKey}" https://your-app.fly.dev/api/users`,
);
console.log(
  "\n⚠️  Keep this secret secure and never commit it to version control!",
);
