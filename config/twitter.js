const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;

passport.use(new TwitterStrategy({
  consumerKey: process.env.TWITTER_CONSUMER_KEY,
  consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
  callbackURL: 'http://localhost:3000/auth/twitter/callback'
}, 
(token, tokenSecret, profile, done) => {
  console.log('✅ Raw Twitter profile body:', profile._raw);
  console.log('✅ Twitter tokens:', { token, tokenSecret });

  const user = {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    photo: profile.photos?.[0]?.value,
    token,
    tokenSecret
  };

  console.log('✅ Twitter profile object:', user);
  done(null, user);
}));
