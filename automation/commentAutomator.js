// automation/commentAutomator.js
const youtubeApi = require('../services/youtubeApi');
const geminiApi = require('../services/geminiApi'); // Only if you want AI-generated replies

let monitoringInterval = null;
let lastCheckedCommentIds = new Set(); // Keep track of comments already processed

/**
 * Checks for new comments on a YouTube video and attempts to reply.
 * @param {string} accessToken - The OAuth 2.0 access token.
 * @param {string} videoId - The ID of the YouTube video to monitor.
 */
async function checkForNewComments(accessToken, videoId) {
    try {
        console.log(`Checking for new comments on video: ${videoId}`);
        const comments = await youtubeApi.fetchComments(accessToken, videoId);

        if (!comments || comments.length === 0) {
            console.log('No comments found or fetched for this video.');
            return;
        }

        // Filter for new comments that haven't been processed yet
        // A comment is considered new if its ID is not in our 'lastCheckedCommentIds' set.
        const newComments = comments.filter(comment => !lastCheckedCommentIds.has(comment.id));

        if (newComments.length === 0) {
            console.log('No new comments to process.');
        } else {
            console.log(`Found ${newComments.length} new comments.`);
        }

        for (const commentThread of newComments) {
            const topLevelComment = commentThread.snippet.topLevelComment;
            const commentId = topLevelComment.id;
            const commentText = topLevelComment.snippet.textOriginal;
            const authorDisplayName = topLevelComment.snippet.authorDisplayName;

            console.log(`Processing new comment from ${authorDisplayName}: "${commentText}" (ID: ${commentId})`);

            // --- Your Reply Logic Here ---
            // This is where you decide if and what to reply.
            // Example: Reply to every new top-level comment.

            let replyText = `Thanks for your comment, ${authorDisplayName}!`; // Default reply

            // If Gemini API is integrated, try to generate a more intelligent reply
            if (geminiApi && typeof geminiApi.generateText === 'function') {
                try {
                    replyText = await geminiApi.generateText(`Write a concise, friendly, and appreciative reply to the following YouTube comment on my video: "${commentText}"`);
                } catch (llmError) {
                    console.error('Error generating reply with Gemini API, using default reply:', llmError);
                }
            }

            try {
                await youtubeApi.postComment(accessToken, videoId, replyText, commentId);
                console.log(`Successfully replied to comment ${commentId}.`);
            } catch (postError) {
                console.error(`Failed to post reply to comment ${commentId}:`, postError);
            }

            // Add the processed comment ID to the set to avoid re-processing in subsequent checks
            lastCheckedCommentIds.add(commentId);
        }

        // Optional: To prevent the 'lastCheckedCommentIds' set from growing indefinitely,
        // you might want to implement a cleanup strategy (e.g., remove oldest IDs).
        // if (lastCheckedCommentIds.size > 1000) {
        //     const oldestIds = Array.from(lastCheckedCommentIds).slice(0, lastCheckedCommentIds.size - 1000);
        //     oldestIds.forEach(id => lastCheckedCommentIds.delete(id));
        // }

    } catch (error) {
        console.error('Error in checkForNewComments:', error);
    }
}

/**
 * Starts monitoring a YouTube video for new comments at a specified interval.
 * @param {string} accessToken - The OAuth 2.0 access token.
 * @param {string} videoId - The ID of the YouTube video to monitor.
 * @param {number} intervalMs - The interval in milliseconds to check for new comments (e.g., 60000 for 1 minute).
 */
function startMonitoring(accessToken, videoId, intervalMs = 60000) {
    if (!accessToken || !videoId) {
        console.error('Access token and video ID are required to start monitoring.');
        return;
    }

    // Clear any existing interval to prevent multiple monitors running simultaneously
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        console.log('Stopped previous comment monitoring before starting new one.');
    }

    // Immediately check for comments on start, then set up recurring check
    checkForNewComments(accessToken, videoId); // Initial check
    monitoringInterval = setInterval(() => checkForNewComments(accessToken, videoId), intervalMs);
    console.log(`Started monitoring video "${videoId}" for new comments every ${intervalMs / 1000} seconds.`);
}

/**
 * Stops the comment monitoring process.
 */
function stopMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        console.log('Stopped comment monitoring.');
    } else {
        console.log('No active comment monitoring to stop.');
    }
}

module.exports = {
    startMonitoring,
    stopMonitoring
};
