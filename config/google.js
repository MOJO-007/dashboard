// config/google.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Configure the Google OAuth 2.0 Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID, // Get from Google Developer Console
  clientSecret: process.env.GOOGLE_CLIENT_SECRET, // Get from Google Developer Console
  callbackURL: 'http://localhost:3000/auth/google/callback' // This must match the authorized redirect URI in Google Console
},
(accessToken, refreshToken, profile, done) => {
  // This callback function is executed after Google successfully authenticates the user.
  // 'profile' contains the user's information from Google.
  // 'done' is a callback to tell Passport that authentication is complete.

  console.log('✅ Google profile received:', profile.displayName);

  // Create a user object with relevant profile information.
  // Ensure 'profile.photos' is accessed safely with optional chaining.
  const user = {
    id: profile.id, // Google's unique ID for the user
    displayName: profile.displayName,
    email: profile.emails?.[0]?.value, // Access the first email if available
    photo: profile.photos?.[0]?.value, // Access the first photo if available
    accessToken, // Store the access token for making further API calls
    refreshToken // Store the refresh token if 'offline_access' scope is requested
  };

  // Call 'done' to complete the authentication process.
  // The 'user' object passed here will be serialized and stored in the session.
  done(null, user);
}));
