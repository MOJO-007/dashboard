// services/youtubeApi.js
// Explicitly destructure the 'default' export from node-fetch.
// This is the most robust way to import node-fetch v3+ in CommonJS.
const { default: fetch } = require('node-fetch');

// --- DEBUGGING: Check if fetch is correctly loaded at module load time ---
console.log('DEBUG (youtubeApi.js - module load): Type of fetch:', typeof fetch);
// --- END DEBUGGING ---

const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

/**
 * Fetches comments for a given YouTube video.
 * @param {string} accessToken - The OAuth 2.0 access token with YouTube scopes.
 * @param {string} videoId - The ID of the YouTube video.
 * @returns {Promise<Array>} A promise that resolves to an array of commentThread resources.
 */
async function fetchComments(accessToken, videoId) {
    // Requesting 'snippet' part for basic comment info.
    // maxResults can be up to 100.
    const url = `${YOUTUBE_API_BASE_URL}/commentThreads?part=snippet&videoId=${videoId}&maxResults=100`;
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('YouTube API Error (fetchComments):', errorData);
            throw new Error(`Failed to fetch comments: ${response.status} - ${errorData.error.message || response.statusText}`);
        }

        const data = await response.json();
        console.log(`Fetched ${data.items.length} comments for video ${videoId}.`);
        return data.items; // Returns an array of commentThread resources
    } catch (error) {
        console.error('Error in fetchComments:', error);
        throw error;
    }
}

/**
 * Posts a new comment or replies to an existing comment on a YouTube video.
 * @param {string} accessToken - The OAuth 2.0 access token with YouTube scopes.
 * @param {string} videoId - The ID of the YouTube video.
 * @param {string} textContent - The text content of the comment.
 * @param {string|null} parentCommentId - The ID of the parent comment if it's a reply, otherwise null for a top-level comment.
 * @returns {Promise<Object>} A promise that resolves to the posted comment resource.
 */
async function postComment(accessToken, videoId, textContent, parentCommentId = null) {
    const url = `${YOUTUBE_API_BASE_URL}/commentThreads?part=snippet`;
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    let requestBody;
    if (parentCommentId) {
        // Construct request body for a reply to an existing comment
        requestBody = {
            snippet: {
                parentId: parentCommentId,
                videoId: videoId,
                textOriginal: textContent
            }
        };
    } else {
        // Construct request body for a new top-level comment
        requestBody = {
            snippet: {
                videoId: videoId,
                topLevelComment: {
                    textOriginal: textContent
                }
            }
        };
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('YouTube API Error (postComment):', errorData);
            throw new Error(`Failed to post comment: ${response.status} - ${errorData.error.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('Comment posted successfully:', data.id);
        return data;
    } catch (error) {
        console.error('Error in postComment:', error);
        throw error;
    }
}

/**
 * Fetches the authenticated user's channel ID.
 * This is needed to get their uploaded videos.
 * @param {string} accessToken - The OAuth 2.0 access token.
 * @returns {Promise<string>} A promise that resolves to the channel ID.
 */
async function getMyChannelId(accessToken) {
    // --- DEBUGGING: Check type of fetch right before call ---
    console.log('DEBUG (getMyChannelId - before fetch): Type of fetch:', typeof fetch);
    // --- END DEBUGGING ---

    // 'mine=true' indicates that we want the channel of the authenticated user.
    const url = `${YOUTUBE_API_BASE_URL}/channels?part=id&mine=true`;
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('YouTube API Error (getMyChannelId):', errorData);
            throw new Error(`Failed to get channel ID: ${response.status} - ${errorData.error.message || response.statusText}`);
        }

        const data = await response.json();
        if (data.items && data.items.length > 0) {
            console.log('Fetched channel ID:', data.items[0].id);
            return data.items[0].id;
        } else {
            throw new Error('No channel found for the authenticated user.');
        }
    } catch (error) {
        console.error('Error in getMyChannelId:', error);
        throw error;
    }
}

/**
 * Fetches videos uploaded by the authenticated user.
 * @param {string} accessToken - The OAuth 2.0 access token.
 * @param {string} channelId - The ID of the channel to fetch videos from.
 * @returns {Promise<Array>} A promise that resolves to an array of playlistItem resources.
 */
async function fetchMyVideos(accessToken, channelId) {
    // To get uploaded videos, we need the 'uploads' playlist ID for the channel.
    // This is typically found in the channel's contentDetails.
    // First, fetch channel details to get the uploads playlist ID.
    const channelDetailsUrl = `${YOUTUBE_API_BASE_URL}/channels?part=contentDetails&id=${channelId}`;
    let uploadsPlaylistId;

    try {
        const channelResponse = await fetch(channelDetailsUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });
        if (!channelResponse.ok) {
            const errorData = await channelResponse.json();
            throw new Error(`Failed to get channel content details: ${channelResponse.status} - ${errorData.error.message || channelResponse.statusText}`);
        }
        const channelData = await channelResponse.json();
        if (channelData.items && channelData.items.length > 0) {
            uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
            console.log('Found uploads playlist ID:', uploadsPlaylistId);
        } else {
            throw new Error('Could not find uploads playlist for the channel.');
        }

        // Now fetch items from the uploads playlist
        // 'snippet' part includes video title, thumbnail, etc.
        // maxResults can be up to 50.
        const playlistItemsUrl = `${YOUTUBE_API_BASE_URL}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50`;
        const videoResponse = await fetch(playlistItemsUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!videoResponse.ok) {
            const errorData = await videoResponse.json();
            throw new Error(`Failed to fetch videos from playlist: ${videoResponse.status} - ${errorData.error.message || videoResponse.statusText}`);
        }

        const videoData = await videoResponse.json();
        console.log(`Fetched ${videoData.items.length} videos from your channel.`);
        return videoData.items; // Returns an array of playlistItem resources
    } catch (error) {
        console.error('Error in fetchMyVideos:', error);
        throw error;
    }
}


module.exports = {
    fetchComments,
    postComment,
    getMyChannelId,
    fetchMyVideos
};
