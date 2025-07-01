// server.js
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const passport = require('passport');
const session = require('express-session');

// Import your authentication routes (which also export userAccessTokens)
const authRouter = require('./routes/auth');
const { userAccessTokens } = authRouter; // Destructure userAccessTokens from the exported module

// Import your automation logic (still used for the 'Start Automation' button)
const commentAutomator = require('./automation/commentAutomator');

// Import the youtubeApi service
const youtubeApi = require('./services/youtubeApi');
// Import the geminiApi service (optional, only if you want AI analysis/replies)
const geminiApi = require('./services/geminiApi');

// Load Passport strategies
require('./config/google');
// require('./config/twitter'); // Uncomment if you have a Twitter strategy set up

const app = express();

// --- Middleware Setup ---
// Parse JSON request bodies (needed for new API endpoints)
app.use(express.json());

// --- Temporary In-Memory User Store (NOT FOR PRODUCTION) ---
// In a real application, you would use a database (e.g., MongoDB, PostgreSQL)
// to store and retrieve user data persistently. This is just for demonstration.
const users = {}; // Stores user objects by ID

// 1. express-session MUST come before passport.initialize() and passport.session()
app.use(session({
  secret: process.env.SESSION_SECRET || 'a_very_secret_key_for_your_session', // Use an environment variable for better security
  resave: false, // Don't save session if unmodified
  saveUninitialized: true, // Save new sessions
  cookie: { secure: process.env.NODE_ENV === 'production' } // Use secure cookies in production (requires HTTPS)
}));

// 2. Passport initialization
app.use(passport.initialize());

// 3. Passport session middleware (relies on req.session being available from express-session)
app.use(passport.session());

// --- Passport Serialization and Deserialization ---
// These functions determine what user data is stored in the session
// and how the full user object is retrieved from that data.

// serializeUser: Determines which data of the user object should be stored in the session.
// We store only the user's ID to keep the session small.
passport.serializeUser((user, done) => {
  console.log('Serializing user ID:', user.id);
  // Store the full user object in our temporary 'users' store for deserialization.
  // In a real app, you'd save to a database here if it's a new user,
  // or just ensure the user exists and return their ID.
  users[user.id] = user;
  done(null, user.id); // Pass the user's ID to be stored in the session
});

// deserializeUser: Retrieves the full user object based on the ID stored in the session.
// This function is called on every request after the session is established.
passport.deserializeUser((id, done) => {
  console.log('Deserializing user ID:', id);
  // In a real app, you'd fetch the user from your database using the ID.
  const user = users[id]; // Retrieve user from our temporary store
  if (user) {
    done(null, user); // Pass the full user object to req.user
  } else {
    done(new Error('User not found in temporary store.'), null);
  }
});

// Mount your authentication routes
app.use('/auth', authRouter); // Use authRouter here

// Middleware to ensure user is authenticated for certain routes
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // Redirect to Google login if not authenticated
  res.redirect('/auth/google');
}

// --- Automation Routes (still available, but moved from main dashboard UI) ---
app.get('/start-automation', ensureAuthenticated, (req, res) => {
  const videoId = req.query.videoId; // Get video ID from query parameter
  const accessToken = userAccessTokens[req.user.id]; // Retrieve token for current user

  if (!videoId) {
    return res.status(400).send('Error: videoId query parameter is required.');
  }
  if (!accessToken) {
    return res.status(401).send('Error: Access token not found for your session. Please re-authenticate.');
  }

  try {
    commentAutomator.startMonitoring(accessToken, videoId);
    res.send(`Automation started for video ID: ${videoId}. Check server console for logs.`);
  } catch (error) {
    console.error('Failed to start automation:', error);
    res.status(500).send('Failed to start automation. Check server logs.');
  }
});

app.get('/stop-automation', (req, res) => {
  commentAutomator.stopMonitoring();
  res.send('Automation stopped.');
});

// --- Dashboard for My YouTube Videos and Comments ---
app.get('/my-videos', ensureAuthenticated, async (req, res) => {
    const accessToken = userAccessTokens[req.user.id];

    if (!accessToken) {
        return res.status(401).send('Error: Access token not found. Please re-authenticate.');
    }

    try {
        const channelId = await youtubeApi.getMyChannelId(accessToken);
        const videos = await youtubeApi.fetchMyVideos(accessToken, channelId);

        let videosHtml = '<h2>Your Uploaded Videos</h2>';
        if (videos.length === 0) {
            videosHtml += '<p>No videos found on your channel.</p>';
        } else {
            videosHtml += '<ul style="list-style: none; padding: 0;">';
            for (const video of videos) {
                const videoId = video.snippet.resourceId.videoId;
                const title = video.snippet.title;
                const thumbnailUrl = video.snippet.thumbnails.medium ? video.snippet.thumbnails.medium.url : 'https://placehold.co/120x90/cccccc/333333?text=No+Thumbnail';

                videosHtml += `
                    <li style="margin-bottom: 20px; border: 1px solid #ddd; padding: 10px; border-radius: 8px; display: flex; align-items: center; background-color: #fcfcfc;">
                        <img src="${thumbnailUrl}" alt="${title}" style="width: 120px; height: 90px; margin-right: 15px; border-radius: 4px;">
                        <div>
                            <h3>${title}</h3>
                            <p>Video ID: ${videoId}</p>
                            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" style="color: #007bff; text-decoration: none;">Watch on YouTube</a>
                            <br>
                            <button onclick="fetchAndDisplayComments('${videoId}', this)" style="margin-top: 8px;">Show Comments</button>
                            <div id="comments-${videoId}" style="margin-top: 10px; border-top: 1px dashed #eee; padding-top: 10px; display: none;">
                                Loading comments...
                            </div>
                        </div>
                    </li>
                `;
            }
            videosHtml += '</ul>';
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>My YouTube Videos</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background-color: #f0f2f5; color: #333; line-height: 1.6; }
                    .container { max-width: 960px; margin: 20px auto; background-color: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
                    h1, h2, h3, h4 { color: #2c3e50; margin-bottom: 15px; }
                    p { margin-bottom: 10px; }
                    a { color: #3498db; text-decoration: none; transition: color 0.3s ease; }
                    a:hover { text-decoration: underline; }
                    button {
                        background-color: #2ecc71; /* Green for action */
                        color: white;
                        border: none;
                        padding: 8px 15px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 0.9em;
                        margin-top: 5px;
                        margin-right: 5px; /* Added for spacing between buttons */
                        transition: background-color 0.3s ease, transform 0.2s ease;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    button:hover {
                        background-color: #27ae60;
                        transform: translateY(-1px);
                    }
                    button:active {
                        transform: translateY(0);
                        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                    .comment-item {
                        background-color: #f0f8ff; /* Light blue for comments */
                        border: 1px solid #e0eaff;
                        padding: 12px;
                        margin-bottom: 8px;
                        border-radius: 8px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    }
                    .comment-item strong { color: #2980b9; }
                    .comment-item span { font-size: 0.85em; color: #7f8c8d; }
                    .analysis-result {
                        margin-top: 10px;
                        padding: 10px;
                        background-color: #fff3cd; /* Light yellow for analysis */
                        border: 1px solid #ffeeba;
                        border-radius: 5px;
                        color: #856404;
                        font-size: 0.9em;
                    }
                    .reply-input-area {
                        margin-top: 10px;
                        display: flex;
                        flex-direction: column;
                        gap: 5px;
                    }
                    .reply-input-area textarea {
                        width: 100%;
                        padding: 8px;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        resize: vertical;
                        min-height: 60px;
                    }
                    .reply-input-area button {
                        align-self: flex-end;
                        margin-top: 0;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Your YouTube Dashboard</h1>
                    <p><a href="/">Back to Home</a></p>
                    ${videosHtml}
                </div>

                <script>
                    // Function to fetch and display comments
                    async function fetchAndDisplayComments(videoId, buttonElement) {
                        const commentsDiv = document.getElementById(\`comments-\${videoId}\`);
                        const isVisible = commentsDiv.style.display === 'block';

                        if (isVisible) {
                            commentsDiv.style.display = 'none';
                            buttonElement.textContent = 'Show Comments';
                            return;
                        }

                        commentsDiv.style.display = 'block';
                        commentsDiv.innerHTML = 'Loading comments...';
                        buttonElement.textContent = 'Loading...';
                        buttonElement.disabled = true;

                        try {
                            const response = await fetch(\`/api/comments/\${videoId}\`);
                            if (!response.ok) {
                                const errorText = await response.text();
                                throw new Error(\`HTTP error! status: \${response.status}. Details: \${errorText}\`);
                            }
                            const comments = await response.json();

                            if (comments.length === 0) {
                                commentsDiv.innerHTML = '<p>No comments found for this video.</p>';
                            } else {
                                let commentsHtml = '<h4>Comments:</h4>';
                                comments.forEach(commentThread => {
                                    const topLevelComment = commentThread.snippet.topLevelComment;
                                    const commentId = topLevelComment.id;
                                    const author = topLevelComment.snippet.authorDisplayName;
                                    const text = topLevelComment.snippet.textOriginal;
                                    const publishedAt = new Date(topLevelComment.snippet.publishedAt).toLocaleString();

                                    commentsHtml += \`
                                        <div class="comment-item">
                                            <strong>\${author}</strong> <span style="font-size: 0.8em; color: #666;">(\${publishedAt})</span>
                                            <p id="comment-text-\${commentId}">\${text}</p>
                                            <button onclick="analyzeComment('\${commentId}')" style="background-color: #007bff;">Analyze</button>
                                            <button onclick="showReplyInput('\${commentId}', '\${videoId}')" style="background-color: #ffc107; color: #333;">Reply</button>
                                            <div id="analysis-result-\${commentId}" class="analysis-result" style="display: none;"></div>
                                            <div id="reply-input-\${commentId}" class="reply-input-area" style="display: none;">
                                                <textarea id="reply-textarea-\${commentId}" placeholder="Type your reply here..."></textarea>
                                                <button onclick="postReply('\${commentId}')" style="background-color: #28a745;">Post Reply</button>
                                                <button onclick="hideReplyInput('\${commentId}')" style="background-color: #6c757d;">Cancel</button>
                                            </div>
                                        </div>
                                    \`;
                                });
                                commentsDiv.innerHTML = commentsHtml;
                            }
                        } catch (error) {
                            console.error('Error fetching comments:', error);
                            commentsDiv.innerHTML = \`<p style="color: red;">Failed to load comments: \${error.message}. Please try again later.</p>\`;
                        } finally {
                            buttonElement.textContent = 'Hide Comments';
                            buttonElement.disabled = false;
                        }
                    }

                    // Function to analyze a comment
                    async function analyzeComment(commentId) {
                        const commentText = document.getElementById(\`comment-text-\${commentId}\`).textContent;
                        const analysisResultDiv = document.getElementById(\`analysis-result-\${commentId}\`);
                        analysisResultDiv.style.display = 'block';
                        analysisResultDiv.innerHTML = 'Analyzing...';

                        try {
                            const response = await fetch('/api/analyze-comment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ commentText: commentText })
                            });

                            if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(\`HTTP error! status: \${response.status}. Details: \${errorData.error || response.statusText}\`);
                            }

                            const result = await response.json();
                            // Display sentiment score and analysis
                            analysisResultDiv.innerHTML = \`<strong>Sentiment:</strong> \${result.sentiment} (Score: \${result.score})<br><strong>Analysis:</strong> \${result.analysis}\`;
                        } catch (error) {
                            console.error('Error analyzing comment:', error);
                            analysisResultDiv.innerHTML = \`<p style="color: red;">Analysis failed: \${error.message}</p>\`;
                        }
                    }

                    // Function to show reply input field, now also passes videoId
                    function showReplyInput(commentId, videoId) {
                        const replyInputArea = document.getElementById(\`reply-input-\${commentId}\`);
                        replyInputArea.style.display = 'flex';
                        document.getElementById(\`reply-textarea-\${commentId}\`).focus();
                        // Store videoId on the textarea for easy access in postReply
                        document.getElementById(\`reply-textarea-\${commentId}\`).dataset.videoId = videoId;
                    }

                    // Function to hide reply input field
                    function hideReplyInput(commentId) {
                        const replyInputArea = document.getElementById(\`reply-input-\${commentId}\`);
                        replyInputArea.style.display = 'none';
                        document.getElementById(\`reply-textarea-\${commentId}\`).value = ''; // Clear text
                        delete document.getElementById(\`reply-textarea-\${commentId}\`).dataset.videoId; // Clean up stored videoId
                    }

                    // Function to post a reply, now takes videoId
                    async function postReply(commentId) {
                        const replyTextarea = document.getElementById(\`reply-textarea-\${commentId}\`);
                        const replyText = replyTextarea.value;
                        const videoId = replyTextarea.dataset.videoId; // Get videoId from dataset

                        if (!replyText.trim()) {
                            alert('Reply cannot be empty.'); // Using alert here for simplicity, consider a custom modal
                            return;
                        }
                        if (!videoId) {
                            alert('Video ID not found for this comment. Cannot post reply.');
                            return;
                        }

                        const replyInputArea = document.getElementById(\`reply-input-\${commentId}\`);
                        const postButton = replyInputArea.querySelector('button[onclick^="postReply"]');
                        const originalButtonText = postButton.textContent;
                        postButton.textContent = 'Posting...';
                        postButton.disabled = true;

                        try {
                            const response = await fetch('/api/reply-comment', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Video-Id': videoId // Pass videoId in a custom header
                                },
                                body: JSON.stringify({ commentId: commentId, replyText: replyText })
                            });

                            if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(\`HTTP error! status: \${response.status}. Details: \${errorData.error || response.statusText}\`);
                            }

                            alert('Reply posted successfully!'); // Using alert here for simplicity, consider a custom modal
                            hideReplyInput(commentId); // Hide input after successful post
                            // Optionally, refresh comments for the video to see the new reply
                            // You might need to re-fetch comments for the video here
                        } catch (error) {
                            console.error('Error posting reply:', error);
                            alert(\`Failed to post reply: \${error.message}\`); // Using alert here for simplicity, consider a custom modal
                        } finally {
                            postButton.textContent = originalButtonText;
                            postButton.disabled = false;
                        }
                    }
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Error fetching user videos:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Error</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background-color: #f0f2f5; color: #333; line-height: 1.6; }
                    .container { max-width: 600px; margin: 50px auto; background-color: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); text-align: center; }
                    h1 { color: #e74c3c; }
                    p { color: #555; }
                    a { color: #3498db; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Error Loading Videos</h1>
                    <p>Failed to load your YouTube videos. This could be due to:</p>
                    <ul>
                        <li>You have not granted the necessary YouTube permissions during login.</li>
                        <li>There was an issue communicating with the YouTube API.</li>
                        <li>Your YouTube channel does not have any public videos.</li>
                        <li>API rate limits being exceeded.</li>
                    </ul>
                    <p>Error details: ${error.message}</p>
                    <p><a href="/">Go back to Home</a></p>
                </div>
            </body>
            </html>
        `);
    }
});

// --- API ROUTE: To fetch comments dynamically via AJAX ---
app.get('/api/comments/:videoId', ensureAuthenticated, async (req, res) => {
    const videoId = req.params.videoId;
    const accessToken = userAccessTokens[req.user.id];

    if (!accessToken) {
        return res.status(401).json({ error: 'Access token not found. Please re-authenticate.' });
    }

    try {
        const comments = await youtubeApi.fetchComments(accessToken, videoId);
        res.json(comments);
    } catch (error) {
        console.error(`Error fetching comments for video ${videoId}:`, error);
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

// --- NEW API ROUTE: To analyze a comment using Gemini API ---
app.post('/api/analyze-comment', ensureAuthenticated, async (req, res) => {
    const { commentText } = req.body;
    // accessToken is not strictly needed for Gemini API calls here, as it's a server-to-server call.
    // However, ensure your Gemini API key is correctly configured in services/geminiApi.js.

    if (!commentText) {
        return res.status(400).json({ error: 'Comment text is required for analysis.' });
    }
    if (!geminiApi || typeof geminiApi.generateText !== 'function') {
        return res.status(500).json({ error: 'Gemini API service not available or not correctly configured.' });
    }

    try {
        // Updated prompt to specifically ask for sentiment and a score
        const analysisPrompt = `Perform a sentiment analysis on the following YouTube comment. Provide a sentiment label (e.g., "Positive", "Negative", "Neutral", "Mixed") and a sentiment score on a scale of -1.0 (very negative) to 1.0 (very positive). Also, provide a brief explanation of the sentiment.
        
        Comment: "${commentText}"
        
        Format your response as:
        Sentiment: [Label]
        Score: [Score]
        Explanation: [Brief explanation]`;

        const rawAnalysisResult = await geminiApi.generateText(analysisPrompt);

        // Attempt to parse the structured response from Gemini
        let sentiment = 'N/A';
        let score = 'N/A';
        let explanation = 'Could not parse analysis.';

        const sentimentMatch = rawAnalysisResult.match(/Sentiment: (.+)/);
        if (sentimentMatch && sentimentMatch[1]) {
            sentiment = sentimentMatch[1].trim();
        }

        const scoreMatch = rawAnalysisResult.match(/Score: (.+)/);
        if (scoreMatch && scoreMatch[1]) {
            score = parseFloat(scoreMatch[1].trim());
            if (isNaN(score)) score = 'N/A';
        }

        const explanationMatch = rawAnalysisResult.match(/Explanation: (.+)/s); // /s for dotall to match across newlines
        if (explanationMatch && explanationMatch[1]) {
            explanation = explanationMatch[1].trim();
        }

        res.json({ sentiment: sentiment, score: score, analysis: explanation });
    } catch (error) {
        console.error('Error analyzing comment:', error);
        res.status(500).json({ error: 'Failed to analyze comment.' });
    }
});

// --- NEW API ROUTE: To post a reply to a comment ---
app.post('/api/reply-comment', ensureAuthenticated, async (req, res) => {
    const { commentId, replyText } = req.body;
    const accessToken = userAccessTokens[req.user.id];
    // Retrieve videoId from a custom header sent by the client
    const videoId = req.headers['x-video-id'];

    if (!commentId || !replyText || !videoId) {
        return res.status(400).json({ error: 'Comment ID, reply text, and video ID are required.' });
    }
    if (!accessToken) {
        return res.status(401).json({ error: 'Access token not found. Please re-authenticate.' });
    }

    try {
        await youtubeApi.postComment(accessToken, videoId, replyText, commentId);
        res.json({ message: 'Reply posted successfully!' });
    } catch (error) {
        console.error('Error posting reply:', error);
        res.status(500).json({ error: 'Failed to post reply.' });
    }
});


// Root route with automation links and link to My Videos
app.get('/', (req, res) => {
  const loggedIn = req.user;
  const displayName = loggedIn ? req.user.displayName : 'Guest';
  const email = loggedIn && req.user.email ? req.user.email : '';
  const photo = loggedIn && req.user.photo ? req.user.photo : '';

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YouTube Automation Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background-color: #f0f2f5; color: #333; line-height: 1.6; }
            .container { max-width: 800px; margin: 20px auto; background-color: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
            h1, h2, h3 { color: #2c3e50; margin-bottom: 15px; }
            p { margin-bottom: 10px; }
            a { color: #3498db; text-decoration: none; transition: color 0.3s ease; }
            a:hover { color: #217dbb; text-decoration: underline; }
            button {
                background-color: #2ecc71; /* Green for action */
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 1em;
                transition: background-color 0.3s ease, transform 0.2s ease;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            button:hover {
                background-color: #27ae60;
                transform: translateY(-1px);
            }
            button:active {
                transform: translateY(0);
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            hr { border: 0; border-top: 1px solid #eee; margin: 30px 0; }
            form { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
            form input[type="text"] {
                flex-grow: 1;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 1em;
            }
            .profile-info { display: flex; align-items: center; margin-bottom: 20px; }
            .profile-info img { margin-right: 15px; border: 2px solid #3498db; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>YouTube Automation Dashboard</h1>
            ${loggedIn ? `
                <div class="profile-info">
                    ${photo ? `<img src="${photo}" alt="Profile Picture" width="60" height="60" style="border-radius: 50%;">` : ''}
                    <div>
                        <p>Hello, <strong>${displayName}</strong>!</p>
                        ${email ? `<p>Email: ${email}</p>` : ''}
                        <p><a href="/auth/logout">Logout</a></p>
                    </div>
                </div>
            ` : '<p><a href="/auth/google"><button>Login with Google</button></a></p>'}

            ${loggedIn ? `
                <hr>
                <h2>My Videos & Comments</h2>
                <p>View your uploaded videos and their comments on a dedicated dashboard, and manage replies manually.</p>
                <p><a href="/my-videos"><button>Go to My Videos Dashboard</button></a></p>

                <hr>
                <h2>Automatic Comment Automation (Background)</h2>
                <p>You can still start the automatic comment automation in the background if desired. This will periodically check for new comments on a specified video and reply automatically.</p>
                <form action="/start-automation" method="GET">
                    <label for="autoVideoId">Video ID for Automation:</label>
                    <input type="text" id="autoVideoId" name="videoId" placeholder="e.g., dQw4w9WgXcQ" required>
                    <button type="submit">Start Automatic Automation</button>
                </form>
                <p><a href="/stop-automation"><button style="background-color: #e74c3c;">Stop Automatic Automation</button></a></p>
            ` : '<p>Please log in to manage YouTube features.</p>'}
        </div>
    </body>
    </html>
  `);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
