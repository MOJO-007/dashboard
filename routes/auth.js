// routes/auth.js
const express = require('express');
const passport = require('passport');
const router = express.Router();

// --- IMPORTANT: Store the accessToken for later use ---
// This is a temporary in-memory store for the access token associated with a user ID.
// In a real application, you'd store this securely in a database, along with the refresh token.
const userAccessTokens = {};

// Route to initiate Google OAuth
// This now includes YouTube-specific scopes.
router.get(
  '/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/youtube.force-ssl', // Grants write access to YouTube data (for posting comments)
      'https://www.googleapis.com/auth/youtube.readonly' // Grants read access to YouTube data (for fetching comments)
      // 'https://www.googleapis.com/auth/youtube', // More broad YouTube access
      // 'offline_access' // Request this scope if you need a refresh token for long-term access
    ]
  })
);

// Google OAuth callback route
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    console.log('User authenticated successfully:', req.user.displayName);
    // Store the access token for the authenticated user
    if (req.user && req.user.id && req.user.accessToken) {
      userAccessTokens[req.user.id] = req.user.accessToken;
      console.log(`Access token stored for user: ${req.user.id}`);
      // In a real app, you'd also save req.user.refreshToken to your database here
    } else {
      console.warn('Access token not available or user ID missing after authentication.');
    }
    res.redirect('/'); // Redirect to the root path
  }
);

// Logout route
router.get('/logout', (req, res, next) => {
  if (req.user && req.user.id) {
    delete userAccessTokens[req.user.id]; // Clear token from temporary store on logout
    console.log(`Access token cleared for user: ${req.user.id}`);
  }
  req.logout((err) => { // req.logout requires a callback in newer Passport versions
    if (err) { return next(err); }
    req.session.destroy((err) => { // Destroy the session to clear all session data
      if (err) {
        console.error('Error destroying session:', err);
        return next(err);
      }
      res.redirect('/');
    });
  });
});

// A route to check if the user is logged in and get their token (for debugging/testing)
router.get('/current_user', (req, res) => {
  if (req.user) {
    res.json({
      id: req.user.id,
      displayName: req.user.displayName,
      email: req.user.email,
      photo: req.user.photo,
      // Do NOT send accessToken to the client in a real app! This is for debugging.
      accessToken: userAccessTokens[req.user.id]
    });
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
});

// Export the router and the userAccessTokens for use in other modules (e.g., automation routes)
module.exports = router;
module.exports.userAccessTokens = userAccessTokens; // Export the token store
