# MyFriend

A companion for elderly

![MyFriend](https://growbyte.co/images/robo-companion/myfriend-talking-to-senior.jpg)

In the United States, 16.2 million seniors live completely alone. That's more people than the entire population of several U.S. states combined. Many of them rarely see their family, or not at all, and loneliness becomes part of their daily life.

That's why I'm building [MyFriend](https://growbyte.co/myfriend).

MyFriend has a phone number that you can call any time just to chat, or get some help solving a hard problem. He can also call you on his own initiative to check how you are doing, or to remind you of an important event, like taking your medications or going to the doctor.

More info about this project: https://growbyte.co/myfriend

## 🚀 Project Status

✅ **API with Simple Authentication** - API key-based authentication  
✅ **Deployment Ready** - Configured for Fly.io  
✅ **Database Integration** - Connected to Supabase  

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

# Get users (auth required)
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3001/api/initCall -d '{"phoneNumber": "+1234567890"}'
```

## 🚁 Deploy to Fly.io

```bash
cd api
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch
fly secrets set SUPABASE_URL="..." SUPABASE_SECRET_KEY="..." API_KEY="..."
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
- **Deployment**: Fly.io + Docker

## 📖 API Endpoints

- `GET /health` - Health check (public)
- `POST /api/initCall` - Identify user by phone (requires API key)
