const axios = require('axios');
const { getConfig } = require('./config');

let accessToken = null;
let tokenExpiresAt = 0;

// Clear token cache when refresh token changes
function clearTokenCache() {
  accessToken = null;
  tokenExpiresAt = 0;
}

// Spotify API base URL
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// Get access token using client credentials flow
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  
  // Return cached token if still valid
  if (accessToken && tokenExpiresAt > now + 60) {
    return accessToken;
  }
  
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  
  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }
  
  try {
    // Use refresh token if available, otherwise client credentials
    if (refreshToken) {
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await axios.post('https://accounts.spotify.com/api/token', 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
          }
        }
      );
      
      accessToken = response.data.access_token;
      tokenExpiresAt = now + response.data.expires_in;
      
      // Update refresh token if provided
      if (response.data.refresh_token) {
        process.env.SPOTIFY_REFRESH_TOKEN = response.data.refresh_token;
      }
    } else {
      // Client credentials flow (limited scope)
      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      accessToken = response.data.access_token;
      tokenExpiresAt = now + response.data.expires_in;
    }
    
    return accessToken;
  } catch (error) {
    console.error('Error getting Spotify access token:', error.response?.data || error.message);
    const errorData = error.response?.data;
    if (errorData?.error === 'invalid_client') {
      throw new Error('Invalid Spotify credentials. Please check your CLIENT_ID and CLIENT_SECRET in .env');
    } else if (errorData?.error === 'invalid_grant') {
      throw new Error('Invalid refresh token. Please get a new refresh token and update .env');
    }
    throw new Error(`Failed to authenticate with Spotify: ${errorData?.error_description || error.message}`);
  }
}

// Search for tracks
async function searchTracks(query, limit = 10) {
  const token = await getAccessToken();
  
  try {
    const response = await axios.get(`${SPOTIFY_API_BASE}/search`, {
      params: {
        q: query,
        type: 'track',
        limit: limit
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.data.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      album_art: track.album.images[0]?.url || null,
      duration_ms: track.duration_ms,
      uri: track.uri,
      explicit: track.explicit || false
    }));
  } catch (error) {
    console.error('Error searching tracks:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.error?.message || error.message;
    if (error.response?.status === 401) {
      throw new Error('Spotify authentication failed. Please check your credentials.');
    } else if (error.response?.status === 400) {
      throw new Error(`Invalid search request: ${errorMsg}`);
    }
    throw new Error(`Failed to search tracks: ${errorMsg || 'Unknown error'}`);
  }
}

// Get track by ID
async function getTrack(trackId) {
  const token = await getAccessToken();
  
  try {
    const response = await axios.get(`${SPOTIFY_API_BASE}/tracks/${trackId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const track = response.data;
    return {
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      album_art: track.album.images[0]?.url || null,
      duration_ms: track.duration_ms,
      uri: track.uri,
      explicit: track.explicit || false
    };
  } catch (error) {
    console.error('Error getting track:', error.response?.data || error.message);
    throw new Error('Failed to get track');
  }
}

// Parse Spotify URL to get track ID
function parseSpotifyUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  
  // Handle spotify:track: URI format
  if (url.startsWith('spotify:track:')) {
    return url.replace('spotify:track:', '').split('?')[0];
  }
  
  // Handle web URLs
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const trackIndex = pathParts.indexOf('track');
    
    if (trackIndex !== -1 && pathParts[trackIndex + 1]) {
      return pathParts[trackIndex + 1].split('?')[0];
    }
    
    return null;
  } catch (error) {
    // If URL parsing fails, try to extract track ID directly
    // Handle formats like: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
    const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
    if (trackMatch && trackMatch[1]) {
      return trackMatch[1];
    }
    
    return null;
  }
}

// Get currently playing track (requires user authorization)
async function fetchNowPlayingUncached() {
  const token = await getAccessToken();
  const userId = process.env.SPOTIFY_USER_ID;
  
  if (!userId) {
    return null;
  }
  
  try {
    // Try to get currently playing track
    const response = await axios.get(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.status === 204 || !response.data) {
      return null;
    }
    
    const track = response.data.item;
    return {
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      album_art: track.album.images[0]?.url || null,
      duration_ms: track.duration_ms,
      progress_ms: response.data.progress_ms,
      is_playing: response.data.is_playing
    };
  } catch (error) {
    // If 401, token might need refresh
    if (error.response?.status === 401) {
      // Clear token cache to force refresh
      accessToken = null;
      tokenExpiresAt = 0;
    }
    if (error.response?.status === 429) throw error;
    return null;
  }
}

// Add track to queue (requires user authorization)
async function addToQueueUncached(trackUri) {
  const token = await getAccessToken();
  
  try {
    await axios.post(`${SPOTIFY_API_BASE}/me/player/queue`, null, {
      params: {
        uri: trackUri
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error adding to queue:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      throw new Error('No active Spotify device found. Please start playing music on a device.');
    }
    
    throw new Error('Failed to add track to queue');
  }
}

// Get current queue
async function fetchQueueUncached() {
  const token = await getAccessToken();

  try {
    const response = await axios.get(`${SPOTIFY_API_BASE}/me/player/queue`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    return {
      currently_playing: response.data.currently_playing ? {
        id: response.data.currently_playing.id,
        name: response.data.currently_playing.name,
        artists: response.data.currently_playing.artists.map(a => a.name).join(', '),
        album: response.data.currently_playing.album.name,
        album_art: response.data.currently_playing.album.images[0]?.url || null,
        duration_ms: response.data.currently_playing.duration_ms,
        uri: response.data.currently_playing.uri
      } : null,
      queue: (response.data.queue || []).map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => a.name).join(', '),
        album: track.album.name,
        album_art: track.album.images[0]?.url || null,
        duration_ms: track.duration_ms,
        uri: track.uri
      }))
    };
  } catch (error) {
    if (error.response?.status === 429) throw error;
    console.error('Error getting queue:', error.response?.data || error.message);
    throw new Error('Failed to get queue');
  }
}

// --- Shared cache for read-only playback calls (fork addition) -------------
// Every display screen and guest page polls now-playing/queue. Without sharing,
// each open client multiplies Spotify API calls and quickly triggers HTTP 429.
// This gives all callers one short-lived result, merges concurrent requests
// into a single Spotify call, and honours Retry-After when rate limited,
// serving the last known result instead of blanking the screens.
// Shorter while music plays (screens extrapolate progress between refreshes),
// much longer when idle so an open display doesn't burn requests overnight.
const NOW_PLAYING_TTL_MS = { playing: 4000, idle: 15000 };
const QUEUE_TTL_MS = { playing: 10000, idle: 30000 };
const STALE_MAX_MS = 5 * 60 * 1000; // how long a last-known result may be shown during errors
const DEFAULT_BACKOFF_MS = 10 * 1000;

let rateLimitedUntil = 0;

function noteRateLimit(error) {
  const retryAfterSec = parseInt(error.response?.headers?.['retry-after'], 10);
  const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : DEFAULT_BACKOFF_MS;
  const until = Date.now() + waitMs;
  if (until > rateLimitedUntil) {
    rateLimitedUntil = until;
    console.warn(`Spotify rate limited (429); pausing playback polling for ${Math.round(waitMs / 1000)}s`);
  }
}

let lastKnownPlaying = false;
const ttlFor = (ttl) => (lastKnownPlaying ? ttl.playing : ttl.idle);

function createCachedFetch(fetcher, ttl, onUnavailable) {
  const state = { value: undefined, fetchedAt: 0, inFlight: null };

  async function cachedFetch() {
    const now = Date.now();
    const hasValue = state.value !== undefined;
    const age = now - state.fetchedAt;

    if (hasValue && age < ttlFor(ttl)) return state.value;

    if (now < rateLimitedUntil) {
      if (hasValue && age < STALE_MAX_MS) return state.value;
      return onUnavailable(new Error('Spotify rate limited'));
    }

    if (!state.inFlight) {
      state.inFlight = fetcher()
        .then((value) => {
          state.value = value;
          state.fetchedAt = Date.now();
          return value;
        })
        .finally(() => { state.inFlight = null; });
    }

    try {
      return await state.inFlight;
    } catch (error) {
      if (error.response?.status === 429) noteRateLimit(error);
      if (hasValue && Date.now() - state.fetchedAt < STALE_MAX_MS) return state.value;
      return onUnavailable(error);
    }
  }

  // Next call refetches (keeps the old value as a fallback if that fetch fails)
  cachedFetch.invalidate = () => { state.fetchedAt = 0; };
  return cachedFetch;
}

const getNowPlaying = createCachedFetch(async () => {
  const track = await fetchNowPlayingUncached();
  lastKnownPlaying = Boolean(track?.is_playing);
  return track;
}, NOW_PLAYING_TTL_MS, () => null);
const getQueue = createCachedFetch(fetchQueueUncached, QUEUE_TTL_MS, () => {
  throw new Error('Failed to get queue');
});

// Adding a track changes the queue; make the next read fetch fresh data.
async function addToQueue(trackUri) {
  const result = await addToQueueUncached(trackUri);
  getQueue.invalidate();
  getNowPlaying.invalidate();
  return result;
}

module.exports = {
  searchTracks,
  getTrack,
  parseSpotifyUrl,
  getNowPlaying,
  addToQueue,
  getQueue,
  getAccessToken,
  clearTokenCache
};

