# MyFriend

A companion for elderly

![MyFriend](https://growbyte.co/images/robo-companion/myfriend-talking-to-senior.jpg)

In the United States, 16.2 million seniors live completely alone. That's more people than the entire population of several U.S. states combined. Many of them rarely see their family, or not at all, and loneliness becomes part of their daily life.

That's why I'm building [MyFriend](https://growbyte.co/myfriend).

MyFriend has a phone number that you can call any time just to chat, or get some help solving a hard problem. He can also call you on his own initiative to check how you are doing, or to remind you of an important event, like taking your medications or going to the doctor.

More info about this project: https://growbyte.co/myfriend

## 🚀 Project Status

✅ **API with Simple Authentication** - API key-based authentication  
✅ **Automated Reminder System** - Phone call reminders via ElevenLabs AI  
✅ **Deployment Ready** - Configured for Fly.io  
✅ **Database Integration** - Connected to Supabase  
✅ **Scheduled Calls** - cron-job.org integration for recurring reminders

## 📁 Project Structure

```
myfriend/
├── api/                    # Express.js API server
│   ├── src/
│   │   ├── lib/           # Supabase client
│   │   ├── middleware/    # API key auth middleware
│   │   └── index.ts       # Main server
│   ├── scripts/           # Utility scripts
│   ├── Dockerfile         # Docker configuration
│   ├── fly.toml          # Fly.io deployment config
│   └── README.md         # API documentation
└── README.md             # This file
```

## ✨ Features

- **Voice Companion**: AI-powered voice agent for elderly users (Czech language)
- **User Management**: Track users with personalized greetings
- **Automated Reminders**: Schedule phone call reminders for medications, appointments, etc.
- **Flexible Scheduling**: One-time, daily, weekly, monthly, or yearly reminders
- **Personalization**: Custom greetings using user's nickname in vocative case

## 🚀 Quick Start

### Local Development

1. **Install dependencies**
   ```bash
   cd api
   npm install
   ```

2. **Generate API key**
   ```bash
   npm run generate-secret
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials and API key
   ```

4. **Start server**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`

### Test the API

```bash
# Health check (no auth required)
curl http://localhost:3001/health

# Initialize call (identifies user by phone)
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"caller_id": "+1234567890"}' \
  http://localhost:3001/api/initCall

# Create a daily reminder
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "caller_id": "+1234567890",
    "reminder_text": "vzít si léky",
    "time_hour": 17,
    "time_minute": 0,
    "date": "2026-02-01T00:00:00Z",
    "end_date": "2026-08-31T00:00:00Z",
    "frequency": "daily"
  }' \
  http://localhost:3001/api/createReminder
```

## 🚁 Deploy to Fly.io

```bash
cd api
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch
fly secrets set \
  SUPABASE_URL="..." \
  SUPABASE_SECRET_KEY="..." \
  API_KEY="..." \
  CRONJOB_API_KEY="..." \
  ELEVENLABS_API_KEY="..." \
  ELEVENLABS_AGENT_ID="..." \
  ELEVENLABS_PHONE_ID="..."
fly deploy
```

See [api/README.md](api/README.md) for detailed documentation.

## 🔐 Authentication

All API endpoints (except `/health`) require a single API key.

**Two ways to authenticate:**

1. **Authorization header (Bearer token)**
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" https://your-app.fly.dev/api/users
   ```

2. **x-api-key header**
   ```bash
   curl -H "x-api-key: YOUR_API_KEY" https://your-app.fly.dev/api/users
   ```

## 🛠 Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Single API Key
- **Voice AI**: ElevenLabs conversational AI
- **Scheduling**: cron-job.org for recurring reminders
- **Deployment**: Fly.io + Docker

## 📖 API Endpoints

### User Management
- `GET /health` - Health check (public)
- `POST /api/initCall` - Identify user by phone, returns personalized greeting
- `POST /api/updateFirstName` - Update user's first name
- `POST /api/updateNickname` - Update user's nickname

### Reminders
- `POST /api/createReminder` - Create automated phone call reminder
  - Supports: `once`, `daily`, `weekly`, `monthly`, `yearly` frequencies
  - Optional end date for recurring reminders
  - Integrates with ElevenLabs for AI voice calls
- `GET /api/webhook/reminder` - Internal webhook for scheduled reminder execution

For detailed API documentation, see [api/README.md](api/README.md)

For comprehensive reminder documentation, see [REMINDERS_API.md](REMINDERS_API.md)

## 💊 Reminder System

MyFriend can automatically call users to remind them about:
- Taking medications
- Doctor appointments
- Daily activities
- Special events
- Anything else!

**Example**: Daily medication reminder at 5 PM until August 31st:
```json
{
  "caller_id": "+1234567890",
  "reminder_text": "vzít si Paralen",
  "time_hour": 17,
  "time_minute": 0,
  "date": "2026-02-01T00:00:00Z",
  "end_date": "2026-08-31T00:00:00Z",
  "frequency": "daily",
  "nickname_vocative": "Olivere"
}
```
