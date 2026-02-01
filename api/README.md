# MyFriend API

Express.js API server for MyFriend - a companion application for elderly users.

## Features

- ✅ Simple API key authentication
- ✅ Supabase integration
- ✅ TypeScript support
- ✅ Automated reminder system with phone calls
- ✅ ElevenLabs voice AI integration
- ✅ cron-job.org scheduling
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
     first_name_vocative VARCHAR(100),
     last_name VARCHAR(100),
     nickname VARCHAR(100),
     nickname_vocative VARCHAR(100),
     phone_number VARCHAR(20),
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   
   CREATE INDEX idx_users_phone_number ON users(phone_number);
   
   CREATE TABLE reminders (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     created_at TIMESTAMPTZ DEFAULT NOW(),
     user_id UUID REFERENCES users(id),
     phone_number VARCHAR(20) NOT NULL,
     text TEXT NOT NULL,
     time_hour INT2 NOT NULL,
     time_minute INT2 NOT NULL,
     date TIMESTAMPTZ NOT NULL,
     end_date TIMESTAMPTZ,
     frequency VARCHAR(20) NOT NULL,
     weekdays VARCHAR(50),
     cron_job_id VARCHAR(50)
   );
   
   CREATE INDEX idx_reminders_phone_number ON reminders(phone_number);
   CREATE INDEX idx_reminders_cron_job_id ON reminders(cron_job_id);
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
Identify a user by phone number (for incoming calls). Returns personalized greeting data for ElevenLabs agent.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` or
- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "caller_id": "+1234567890"
}
```

**Response (existing user):**
```json
{
  "type": "conversation_initiation_client_data",
  "dynamic_variables": {
    "caller_id": "+1234567890"
  },
  "conversation_config_override": {
    "agent": {
      "first_message": "Vítej zpět, Olivere!"
    }
  }
}
```

**Response (new user):**
```json
{
  "type": "conversation_initiation_client_data",
  "dynamic_variables": {
    "caller_id": "+1234567890"
  },
  "conversation_config_override": {
    "agent": {
      "first_message": "Ahoj, tady DigiPřítel, jak se jmenuješ ty?"
    }
  }
}
```

#### Update User First Name
```
POST /api/updateFirstName
```
Update a user's first name and vocative form.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` or
- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "caller_id": "+1234567890",
  "first_name": "Oliver",
  "first_name_vocative": "Olivere"
}
```

**Response:**
```json
{
  "message": "Name updated successfully"
}
```

#### Update User Nickname
```
POST /api/updateNickname
```
Update a user's nickname and vocative form.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` or
- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "caller_id": "+1234567890",
  "nickname": "Oliver",
  "nickname_vocative": "Olivere"
}
```

**Response:**
```json
{
  "message": "Nickname updated successfully"
}
```

#### Create Reminder
```
POST /api/createReminder
```
Create an automated phone call reminder using ElevenLabs and cron-job.org scheduling.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` or
- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "caller_id": "+1234567890",
  "reminder_text": "vzít si Paralen",
  "time_hour": 17,
  "time_minute": 0,
  "date": "2026-02-01T00:00:00Z",
  "end_date": "2026-08-31T00:00:00Z",
  "frequency": "daily",
  "weekdays": [1, 3, 5],
  "nickname_vocative": "Olivere"
}
```

**Required Fields:**
- `caller_id` - Phone number to call (E.164 format)
- `reminder_text` - Reminder message
- `time_hour` - Hour (0-23)
- `time_minute` - Minute (0-59)
- `date` - Start date (ISO 8601)
- `frequency` - `"once"`, `"daily"`, `"weekly"`, `"monthly"`, or `"yearly"`

**Optional Fields:**
- `end_date` - End date for recurring reminders (if omitted, runs indefinitely)
- `weekdays` - Array of weekday numbers for weekly frequency (0=Sunday, 6=Saturday)
- `nickname_vocative` - User's nickname for personalized greeting

**Frequency Types:**

- **once**: One-time reminder on specific date
- **daily**: Every day at specified time
- **weekly**: Specific days of week (requires `weekdays`)
- **monthly**: Same day each month
- **yearly**: Same date each year

**Response:**
```json
{
  "message": "Reminder created successfully",
  "reminder_id": "695cc382-fe8a-4e25-8d21-16d89b1908e6",
  "cron_job_id": 12345
}
```

**Examples:**

One-time reminder:
```json
{
  "caller_id": "+1234567890",
  "reminder_text": "vzít si léky",
  "time_hour": 17,
  "time_minute": 0,
  "date": "2026-02-15T00:00:00Z",
  "frequency": "once"
}
```

Daily reminder until end date:
```json
{
  "caller_id": "+1234567890",
  "reminder_text": "vzít si léky",
  "time_hour": 8,
  "time_minute": 30,
  "date": "2026-02-01T00:00:00Z",
  "end_date": "2026-08-31T00:00:00Z",
  "frequency": "daily"
}
```

Weekly reminder (Mondays and Wednesdays):
```json
{
  "caller_id": "+1234567890",
  "reminder_text": "jít na procházku",
  "time_hour": 10,
  "time_minute": 30,
  "date": "2026-02-01T00:00:00Z",
  "end_date": "2026-12-31T00:00:00Z",
  "frequency": "weekly",
  "weekdays": [1, 3]
}
```

#### Reminder Webhook (Internal)
```
GET /api/webhook/reminder?id=<reminder_id>
```
Internal endpoint called by cron-job.org to trigger reminder phone calls. Fetches reminder details from database and initiates ElevenLabs call.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY`

**Query Parameters:**
- `id` - UUID of the reminder

**Response:**
```json
{
  "message": "Call initiated successfully"
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
fly secrets set API_URL="https://your-app-name.fly.dev"
fly secrets set CRONJOB_API_KEY="your-cronjob-api-key"
fly secrets set ELEVENLABS_API_KEY="your-elevenlabs-api-key"
fly secrets set ELEVENLABS_AGENT_ID="your-agent-id"
fly secrets set ELEVENLABS_PHONE_ID="your-phone-id"
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
| `API_URL` | Deployed API URL for webhooks | Yes | - |
| `CRONJOB_API_KEY` | cron-job.org API key | Yes | - |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | Yes | - |
| `ELEVENLABS_AGENT_ID` | ElevenLabs agent ID | Yes | - |
| `ELEVENLABS_PHONE_ID` | ElevenLabs phone number ID | Yes | - |

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

## How Reminders Work

1. **Create Reminder**: POST to `/api/createReminder` with reminder details
2. **Save to Database**: Reminder is stored in Supabase with unique ID
3. **Create Cron Job**: A cron job is created on cron-job.org that calls your webhook
4. **Scheduled Execution**: cron-job.org calls `/api/webhook/reminder?id=<reminder_id>` at scheduled times
5. **Fetch & Call**: Webhook fetches reminder from database and triggers ElevenLabs outbound call

## Additional Documentation

For detailed reminder API documentation, see [REMINDERS_API.md](../REMINDERS_API.md)

## License

MIT
