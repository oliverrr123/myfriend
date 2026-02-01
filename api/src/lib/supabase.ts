import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables first
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

export const supabase = createClient(supabaseUrl, supabaseSecretKey);
