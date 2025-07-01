// server.js
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const passport = require('passport');
const session = require('express-session');
const path = require('path'); // Import the 'path' module

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
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON request bodies (needed for new API endpoints)
app.use(express.json());

// --- Temporary In-Memory User Store (NOT FOR PRODUCTION) ---
const users = {}; // Stores user objects by ID

// 1. express-session MUST come before passport.initialize() and passport.session()
app.use(session({
  secret: process.env.SESSION_SECRET || 'a_very_secret_key_for_your_session',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// 2. Passport initialization
app.use(passport.initialize());

// 3. Passport session middleware
app.use(passport.session());

// --- Passport Serialization and Deserialization ---
passport.serializeUser((user, done) => {
  console.log('Serializing user ID:', user.id);
  users[user.id] = user;
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  console.log('Deserializing user ID:', id);
  const user = users[id];
  if (user) {
    done(null, user);
  } else {
    done(new Error('User not found in temporary store.'), null);
  }
});

// Mount your authentication routes
app.use('/auth', authRouter);

// Middleware to ensure user is authenticated for certain routes
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // If not authenticated, redirect to the login page
  res.redirect('/login.html');
}

// --- Automation Routes (still available) ---
app.get('/start-automation', ensureAuthenticated, (req, res) => {
  const videoId = req.query.videoId;
  const accessToken = userAccessTokens[req.user.id];

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

app.get('/stop-automation', ensureAuthenticated, (req, res) => {
  commentAutomator.stopMonitoring();
  res.send('Automation stopped.');
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

// --- API ROUTE: To analyze a comment using Gemini API ---
app.post('/api/analyze-comment', ensureAuthenticated, async (req, res) => {
    const { commentText } = req.body;

    if (!commentText) {
        return res.status(400).json({ error: 'Comment text is required for analysis.' });
    }
    if (!geminiApi || typeof geminiApi.generateText !== 'function') {
        return res.status(500).json({ error: 'Gemini API service not available or not correctly configured.' });
    }

    try {
        const analysisPrompt = `Perform a sentiment analysis on the following YouTube comment. Provide a sentiment label (e.g., "Positive", "Negative", "Neutral", "Mixed") and a sentiment score on a scale of -1.0 (very negative) to 1.0 (very positive). Also, provide a brief explanation of the sentiment.
        
        Comment: "${commentText}"
        
        Format your response as:
        Sentiment: [Label]
        Score: [Score]
        Explanation: [Brief explanation]`;

        const rawAnalysisResult = await geminiApi.generateText(analysisPrompt);

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

        const explanationMatch = rawAnalysisResult.match(/Explanation: (.+)/s);
        if (explanationMatch && explanationMatch[1]) {
            explanation = explanationMatch[1].trim();
        }

        res.json({ sentiment: sentiment, score: score, analysis: explanation });
    } catch (error) {
        console.error('Error analyzing comment:', error);
        res.status(500).json({ error: 'Failed to analyze comment.' });
    }
});

// --- API ROUTE: To post a reply to a comment ---
app.post('/api/reply-comment', ensureAuthenticated, async (req, res) => {
    const { commentId, replyText } = req.body;
    const accessToken = userAccessTokens[req.user.id];
    const videoId = req.headers['x-video-id'];

    console.log('DEBUG (server.js - /api/reply-comment): Received replyText:', `"${replyText}"`);
    console.log('DEBUG (server.js - /api/reply-comment): Trimmed replyText length:', replyText.trim().length);

    if (!commentId || !replyText.trim() || !videoId) {
        console.error('Validation failed: Comment ID, non-empty reply text, and video ID are required.');
        return res.status(400).json({ error: 'Comment ID, non-empty reply text, and video ID are required.' });
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

// --- API ROUTE: To fetch replies dynamically via AJAX ---
app.get('/api/replies/:commentId', ensureAuthenticated, async (req, res) => {
    const commentId = req.params.commentId;
    const accessToken = userAccessTokens[req.user.id];

    if (!commentId) {
        return res.status(400).json({ error: 'Comment ID is required to fetch replies.' });
    }
    if (!accessToken) {
        return res.status(401).json({ error: 'Access token not found. Please re-authenticate.' });
    }

    try {
        const replies = await youtubeApi.fetchReplies(accessToken, commentId);
        res.json(replies);
    } catch (error) {
        console.error(`Error fetching replies for comment ${commentId}:`, error);
        res.status(500).json({ error: 'Failed to fetch replies.' });
    }
});

// --- NEW API ROUTE: To provide video data to the frontend (youtube-dashboard.html) ---
app.get('/api/my-videos-data', ensureAuthenticated, async (req, res) => {
    const accessToken = userAccessTokens[req.user.id];

    if (!accessToken) {
        return res.status(401).json({ error: 'Access token not found. Please re-authenticate.' });
    }

    try {
        const channelId = await youtubeApi.getMyChannelId(accessToken);
        const videos = await youtubeApi.fetchMyVideos(accessToken, channelId);
        res.json(videos); // Send raw video data as JSON
    } catch (error) {
        console.error('Error fetching user videos data:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user videos data.' });
    }
});


// Root route - serves login.html if not authenticated, redirects to dashboard if authenticated
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    // If authenticated, redirect to the YouTube dashboard
    res.redirect('/youtube-dashboard.html');
  } else {
    // If not authenticated, serve the login page
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
