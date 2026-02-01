# Quick Start Guide

Get your MyFriend API running locally and deployed in minutes.

## 🚀 Local Setup (5 minutes)

### 1. Install Dependencies
```bash
cd api
npm install
```

### 2. Generate API Key
```bash
npm run generate-secret
```

Copy the generated key - you'll need it next!

### 3. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```env
PORT=3001
NODE_ENV=development

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-secret-key

API_KEY=paste-your-generated-key-here
```

### 4. Set Up Database

Run this in your Supabase SQL editor:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone_number VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_phone_number ON users(phone_number);
```

### 5. Start the Server
```bash
npm run dev
```

Server running at `http://localhost:3001` ✅

### 6. Test It
```bash
# Health check (no auth needed)
curl http://localhost:3001/health

# Get users (auth required)
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3001/api/users
```

## 🚁 Deploy to Fly.io (10 minutes)

### 1. Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### 2. Login
```bash
fly auth login
```

### 3. Launch App
```bash
cd api
fly launch
```

Choose:
- Unique app name
- Region closest to your users
- **NO** to PostgreSQL (using Supabase)
- **NO** to Redis
- **NO** to deploy now

### 4. Set Secrets
```bash
fly secrets set SUPABASE_URL="https://your-project.supabase.co"
fly secrets set SUPABASE_SECRET_KEY="your-secret-key"
fly secrets set API_KEY="your-generated-api-key"
```

### 5. Deploy
```bash
fly deploy
```

### 6. Verify
```bash
fly status
curl https://your-app-name.fly.dev/health
```

## 🔐 Using Your API

### Two Ways to Authenticate

**Option 1: Authorization Header**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-app.fly.dev/api/users
```

**Option 2: x-api-key Header**
```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://your-app.fly.dev/api/users
```

### Example: Create a User
```bash
curl -X POST https://your-app.fly.dev/api/users \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com"
  }'
```

### Example: Initialize Call
```bash
curl -X POST https://your-app.fly.dev/api/initCall \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+1234567890"
  }'
```

## 🛠 Useful Commands

### Local Development
```bash
npm run dev              # Start dev server with hot reload
npm run build            # Build TypeScript
npm start                # Run production build
npm run generate-secret  # Generate new API key
```

### Fly.io Management
```bash
fly status              # Check app status
fly logs                # View real-time logs
fly deploy              # Deploy new version
fly scale count 2       # Scale to 2 instances
fly apps restart        # Restart app
fly ssh console         # SSH into machine
```

## 📝 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Your API authentication key |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase secret key |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment (default: development) |

## 🆘 Troubleshooting

**"Server configuration error"**
→ Make sure `API_KEY` is set in your `.env` file

**"Invalid or missing API key"**
→ Check that you're sending the correct API key in the header

**Build fails**
→ Run `npm run build` locally first to check for TypeScript errors

**App won't start on Fly.io**
→ Check secrets: `fly secrets list`
→ View logs: `fly logs`

## ✅ You're Done!

Your API is now:
- ✅ Running locally for development
- ✅ Deployed to production on Fly.io
- ✅ Protected with API key authentication
- ✅ Connected to Supabase
- ✅ Ready to use

For more details, see [api/README.md](api/README.md)