// services/geminiApi.js
// Explicitly destructure the 'default' export from node-fetch.
// This is the most robust way to import node-fetch v3+ in CommonJS.
const { default: fetch } = require('node-fetch');

// --- DEBUGGING: Check if fetch is correctly loaded at module load time ---
console.log('DEBUG (geminiApi.js - module load): Type of fetch:', typeof fetch);
// --- END DEBUGGING ---

// You don't need to provide an API key here if running in a Canvas environment
// as it will be automatically provided for gemini-2.0-flash.
// If running outside Canvas or using other models, you'd set process.env.GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // Leave empty for Canvas auto-injection
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Generates text using the Gemini API based on a given prompt.
 * @param {string} prompt - The text prompt for the LLM.
 * @returns {Promise<string>} A promise that resolves to the generated text.
 */
async function generateText(prompt) {
    // --- DEBUGGING: Check type of fetch right before call ---
    console.log('DEBUG (generateText - before fetch): Type of fetch:', typeof fetch);
    // --- END DEBUGGING ---

    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });

    const payload = { contents: chatHistory };

    try {
        const response = await fetch(GEMINI_API_URL, { // This is line 22 in your previous error
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API Error:', errorData);
            throw new Error(`Failed to generate text: ${response.status} - ${errorData.error.message || response.statusText}`);
        }

        const result = await response.json();

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            console.log('Gemini generated text:', text);
            return text;
        } else {
            console.warn('Gemini API response structure unexpected or content missing:', result);
            return "Could not generate a reply.";
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        return "Error generating reply.";
    }
}

module.exports = {
    generateText
};
