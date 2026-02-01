# MyFriend API

Express.js API server for MyFriend - a companion application for elderly users.

## Features

- ✅ Simple API key authentication
- ✅ Supabase integration
- ✅ TypeScript support
- ✅ Ready for Fly.io deployment

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: API Key
- **Deployment**: Fly.io

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm or yarn
- Supabase account

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Generate an API key:
   ```bash
   npm run generate-secret
   ```

4. Update the `.env` file with your credentials:
   ```env
   PORT=3001
   NODE_ENV=development
   
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-secret-key
   
   API_KEY=your-generated-api-key
   ```

5. Set up your database schema in Supabase:
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

### Development

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

### Build & Production

Build the TypeScript code:
```bash
npm run build
```

Run the production build:
```bash
npm start
```

## API Endpoints

All endpoints (except `/health`) require authentication.

### Authentication

Include your API key in one of two ways:

**Option 1: Authorization header (Bearer token)**
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3001/api/users -d '{"phone_number": "+1234567890"}'
```

**Option 2: x-api-key header**
```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3001/api/users
```

### Endpoints

#### Health Check (Public)
```
GET /health
```
Returns the API status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Initialize Call
```
POST /api/initCall
```
Identify a user by phone number (for incoming calls).

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` or
- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "phoneNumber": "+1234567890"
}
```

**Response:**
```json
{
  "message": "Welcome back, John!"
}
```

## Deploy to Fly.io

### 1. Install Fly.io CLI

**macOS/Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Windows:**
```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### 2. Login
```bash
fly auth login
```

### 3. Launch App
```bash
fly launch
```

Choose:
- App name (unique)
- Region (closest to users)
- NO to PostgreSQL
- NO to Redis
- NO to deploy now

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
fly logs
curl https://your-app-name.fly.dev/health
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | `3001` |
| `NODE_ENV` | Environment | No | `development` |
| `SUPABASE_URL` | Supabase project URL | Yes | - |
| `SUPABASE_SECRET_KEY` | Supabase secret key | Yes | - |
| `API_KEY` | API authentication key | Yes | - |

## Project Structure

```
api/
├── src/
│   ├── lib/
│   │   └── supabase.ts       # Supabase client
│   ├── middleware/
│   │   └── auth.ts            # API key middleware
│   └── index.ts               # Main server
├── scripts/
│   └── generate-secret.js     # API key generator
├── .env.example               # Environment template
├── Dockerfile                 # Docker config
├── fly.toml                   # Fly.io config
└── README.md                  # This file
```

## Security

- ✅ API key authentication
- ✅ HTTPS enforced (automatic with Fly.io)
- ✅ Environment variables as secrets
- ✅ Non-root Docker user

## Monitoring

```bash
# View logs
fly logs

# Check status
fly status

# Scale app
fly scale count 2

# Restart app
fly apps restart
```

## Error Responses

All errors return JSON with an `error` field:

```json
{
  "error": "Invalid or missing API key"
}
```

HTTP Status Codes:
- `200` - Success
- `201` - Created
- `401` - Unauthorized (invalid/missing API key)
- `500` - Internal Server Error

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run production server
- `npm run generate-secret` - Generate secure API key

## License

MIT
