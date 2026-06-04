from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import os
import base64
import time

app = FastAPI()

# Allow CORS so your React app can talk to this server from anywhere (localhost or production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, change this to your app's domain if possible
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load environment variables
CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")

# Simple in-memory cache to avoid hitting Spotify too often
# Structure: {'token': '...', 'expires_at': 1234567890}
token_cache = {}

@app.get("/")
def home():
    return {"status": "ok", "service": "Spotify Token Proxy"}

@app.get("/token")
def get_spotify_token():
    global token_cache
    
    if not CLIENT_ID or not CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Server misconfigured: Missing Spotify credentials")

    # Check valid cache
    if token_cache and token_cache.get('expires_at', 0) > time.time():
        return token_cache['payload']

    # Request new token
    auth_url = 'https://accounts.spotify.com/api/token'
    
    # Spotify requires Base64 encoded ID:Secret
    auth_str = f"{CLIENT_ID}:{CLIENT_SECRET}"
    b64_auth = base64.b64encode(auth_str.encode()).decode()

    headers = {
        'Authorization': f'Basic {b64_auth}',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    data = {'grant_type': 'client_credentials'}

    try:
        response = requests.post(auth_url, headers=headers, data=data)
        response.raise_for_status()
        
        json_data = response.json()
        
        # Cache the result (expires_in is usually 3600 seconds)
        # We subtract 60s buffer to be safe
        expires_in = json_data.get('expires_in', 3600)
        token_cache = {
            'payload': json_data,
            'expires_at': time.time() + expires_in - 60
        }
        
        return json_data
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching token: {e}")
        raise HTTPException(status_code=502, detail="Failed to communicate with Spotify")

@app.get("/client-id")
def get_client_id():
    """
    Returns the PUBLIC Spotify client ID so the desktop app can run the
    Authorization Code + PKCE flow (user login). The client secret is
    never exposed - PKCE does not need it.
    """
    if not CLIENT_ID:
        raise HTTPException(status_code=500, detail="Server misconfigured: Missing Spotify client ID")
    return {"client_id": CLIENT_ID}

@app.get("/config")
def get_config():
    """
    Returns dynamic configuration for the frontend (messages, toasts).
    Controlled via Environment Variables on Render.
    """
    return {
        "release": {
            "text": os.environ.get("RELEASE_TEXT"),
            "link": os.environ.get("RELEASE_LINK")
        },
        "toast": {
            "text": os.environ.get("TOAST_TEXT"),
            "link": os.environ.get("TOAST_LINK")
        }
    }

