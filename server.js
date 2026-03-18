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
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ─── Health check ──────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'PosiFeed backend running' }));

// ─── TWITTER / X OAuth 2.0 ────────────────────────────────────────
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
    req.session.twitter_token = response.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=twitter`);
  } catch (err) {
    console.error('Twitter OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=twitter`);
  }
});

app.get('/api/twitter/feed', async (req, res) => {
  if (!req.session.twitter_token) return res.status(401).json({ error: 'Not connected' });
  try {
    const user = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${req.session.twitter_token}` }
    });
    const tweets = await axios.get(`https://api.twitter.com/2/users/${user.data.data.id}/timelines/reverse_chronological`, {
      headers: { Authorization: `Bearer ${req.session.twitter_token}` },
      params: { max_results: 20, 'tweet.fields': 'created_at,public_metrics,attachments', expansions: 'author_id' }
    });
    res.json(tweets.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REDDIT OAuth 2.0 ─────────────────────────────────────────────
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
    req.session.reddit_token = response.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=reddit`);
  } catch (err) {
    console.error('Reddit OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=reddit`);
  }
});

app.get('/api/reddit/feed', async (req, res) => {
  if (!req.session.reddit_token) return res.status(401).json({ error: 'Not connected' });
  try {
    const feed = await axios.get('https://oauth.reddit.com/best', {
      headers: { Authorization: `Bearer ${req.session.reddit_token}`, 'User-Agent': 'PosiFeed/1.0' },
      params: { limit: 25 }
    });
    res.json(feed.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FACEBOOK OAuth 2.0 ───────────────────────────────────────────
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
    req.session.facebook_token = tokenRes.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=facebook`);
  } catch (err) {
    console.error('Facebook OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=facebook`);
  }
});

app.get('/api/facebook/feed', async (req, res) => {
  if (!req.session.facebook_token) return res.status(401).json({ error: 'Not connected' });
  try {
    const feed = await axios.get('https://graph.facebook.com/v18.0/me/feed', {
      params: { access_token: req.session.facebook_token, fields: 'id,message,created_time,full_picture,likes.summary(true),comments.summary(true)', limit: 20 }
    });
    res.json(feed.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INSTAGRAM OAuth (via Facebook) ───────────────────────────────
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
    req.session.instagram_token = tokenRes.data.access_token;
    res.redirect(`${process.env.FRONTEND_URL}?connected=instagram`);
  } catch (err) {
    console.error('Instagram OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=instagram`);
  }
});

app.get('/api/instagram/feed', async (req, res) => {
  if (!req.session.instagram_token) return res.status(401).json({ error: 'Not connected' });
  try {
    const feed = await axios.get('https://graph.instagram.com/me/media', {
      params: { fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count', access_token: req.session.instagram_token, limit: 20 }
    });
    res.json(feed.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Session status ────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    twitter: !!req.session.twitter_token,
    reddit: !!req.session.reddit_token,
    facebook: !!req.session.facebook_token,
    instagram: !!req.session.instagram_token
  });
});

// ─── Logout ────────────────────────────────────────────────────────
app.post('/api/logout/:platform', (req, res) => {
  const { platform } = req.params;
  delete req.session[`${platform}_token`];
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`PosiFeed backend running on port ${PORT}`));
