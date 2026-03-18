const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'posifeed-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => res.json({ status: 'PosiFeed backend running' }));

// ─── TWITTER ──────────────────────────────────────────────────────
app.get('/auth/twitter', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID,
    redirect_uri: `${process.env.BACKEND_URL}/auth/twitter/callback`,
    scope: 'tweet.read users.read follows.read offline.access',
    state: 'twitter_state',
    code_challenge: 'challenge',
    code_challenge_method: 'plain'
  });
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

app.get('/auth/twitter/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const response = await axios.post('https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.BACKEND_URL}/auth/twitter/callback`,
        code_verifier: 'challenge'
      }),
      {
        auth: { username: process.env.TWITTER_CLIENT_ID, password: process.env.TWITTER_CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    const token = response.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=twitter&token=${token}&platform=twitter`);
  } catch (err) {
    console.error('Twitter OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=twitter`);
  }
});

// ─── REDDIT ───────────────────────────────────────────────────────
app.get('/auth/reddit', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.REDDIT_CLIENT_ID,
    response_type: 'code',
    state: 'reddit_state',
    redirect_uri: `${process.env.BACKEND_URL}/auth/reddit/callback`,
    duration: 'permanent',
    scope: 'read identity mysubreddits'
  });
  res.redirect(`https://www.reddit.com/api/v1/authorize?${params}`);
});

app.get('/auth/reddit/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const response = await axios.post('https://www.reddit.com/api/v1/access_token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${process.env.BACKEND_URL}/auth/reddit/callback` }),
      {
        auth: { username: process.env.REDDIT_CLIENT_ID, password: process.env.REDDIT_CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PosiFeed/1.0' }
      }
    );
    const token = response.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=reddit&token=${token}&platform=reddit`);
  } catch (err) {
    console.error('Reddit OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=reddit`);
  }
});

// ─── FACEBOOK ─────────────────────────────────────────────────────
app.get('/auth/facebook', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: `${process.env.BACKEND_URL}/auth/facebook/callback`,
    scope: 'public_profile,user_posts,user_friends',
    state: 'facebook_state'
  });
  res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
});

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: `${process.env.BACKEND_URL}/auth/facebook/callback`,
        code
      }
    });
    const token = tokenRes.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=facebook&token=${token}&platform=facebook`);
  } catch (err) {
    console.error('Facebook OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=facebook`);
  }
});

// ─── INSTAGRAM ────────────────────────────────────────────────────
app.get('/auth/instagram', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: `${process.env.BACKEND_URL}/auth/instagram/callback`,
    scope: 'user_profile,user_media',
    response_type: 'code'
  });
  res.redirect(`https://api.instagram.com/oauth/authorize?${params}`);
});

app.get('/auth/instagram/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token',
      new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.BACKEND_URL}/auth/instagram/callback`,
        code
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = tokenRes.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=instagram&token=${token}&platform=instagram`);
  } catch (err) {
    console.error('Instagram OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=instagram`);
  }
});

// ─── Status ────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    twitter: !!req.session.twitter_token,
    reddit: !!req.session.reddit_token,
    facebook: !!req.session.facebook_token,
    instagram: !!req.session.instagram_token
  });
});

app.post('/api/logout/:platform', (req, res) => {
  const { platform } = req.params;
  delete req.session[`${platform}_token`];
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`PosiFeed backend running on port ${PORT}`));
