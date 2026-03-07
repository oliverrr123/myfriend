import express from "express";
import cors from "cors";

export const app = express();

// Middleware
app.use(cors());

// Apply express.json() to all routes EXCEPT the webhook
// The webhook requires raw string parsing via express.text()
app.use((req, res, next) => {
    if (req.originalUrl === '/api/endCall') {
        next();
    } else {
        express.json()(req, res, next);
    }
});
