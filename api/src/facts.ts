import { app } from "./app";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";

// Create a fact
app.post("/api/createFact", authenticateApiKey, async (req, res) => {
    const {
        caller_id,
        fact_text,
    } = req.body;

    // Validate required fields with detailed error messages
    if (!caller_id) {
        return res.status(400).json({ error: "Missing caller_id" });
    }
    if (!fact_text) {
        return res.status(400).json({ error: "Missing fact_text" });
    }

    try {
        // First, save fact to database
        const { data: newFact, error: insertError } = await supabase
            .from("facts")
            .insert({
                phone_number: caller_id,
                text: fact_text,
            })
            .select()
            .single();

        if (insertError || !newFact) {
            console.error("Database error:", insertError);
            return res.status(500).json({ error: "Failed to create fact" });
        }

        res.json({
            message: "Fact created successfully",
            fact_id: newFact.id,
        });
    } catch (error) {
        console.error("Error creating fact:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
