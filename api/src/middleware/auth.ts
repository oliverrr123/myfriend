import { Request, Response, NextFunction } from "express";

/**
 * Simple API key authentication middleware
 * Checks for API key in Authorization header or x-api-key header
 */
export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error("API_KEY environment variable is not set");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check x-api-key header
  const apiKeyHeader = req.headers["x-api-key"] as string;

  // Check if either matches
  if (bearerToken === apiKey || apiKeyHeader === apiKey) {
    next();
  } else {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }
};
