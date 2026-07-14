# ElevenLabs tool configs

Reference configs for MyFriend server tools. These match the tools registered in the ElevenLabs workspace.

## getWeather

Register in **ElevenLabs → Agent → Tools → Add Tool → Webhook**.

| Field | Value |
|---|---|
| Name | `getWeather` |
| Method | `POST` |
| URL | `https://api-nameless-water-1932.fly.dev/api/getWeather` |
| Auth header | `Authorization` → use the same workspace **Bearer secret** as `createReminder` |
| Timeout | 15 seconds |
| Pre-tool speech | Auto |

**Description:**

```
Get current weather for the user or a named place. Call this before answering any weather, temperature, rain, or umbrella question. Never guess weather numbers. If the user names a place, pass location. If they ask generally, omit location to use their saved city or timezone. Read the summary field from the response aloud.
```

**Body parameters:**

| Name | Required | Dynamic variable | Description |
|---|---|---|---|
| `caller_id` | Yes | `system__caller_id` | Current caller phone number |
| `location` | No | — | City/place when user asks about weather somewhere specific, e.g. Prague, Brno, Miami. Omit for local weather. |
| `agent_phone_number` | No | `system__called_number` | Agent line used for the call |

**Attach to agent:** open your agent → Tools → enable `getWeather`.

## udpateTimezone update

Also add this optional body parameter to the existing `udpateTimezone` tool:

| Name | Required | Description |
|---|---|---|
| `city` | No | City/town name, e.g. Prague or Brno. Pass when the user tells you where they live while setting timezone. |

## Programmatic registration

If your ElevenLabs API key has `convai_write` permission:

```bash
cd api
node scripts/register-getWeather-tool.js
```

The script reuses the workspace Bearer secret from `createReminder`, creates/updates `getWeather`, adds `city` to `udpateTimezone`, and attaches the tool to `ELEVENLABS_AGENT_ID`.
