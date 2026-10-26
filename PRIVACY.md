# Privacy Policy

Audio Recorder records audio only after the user clicks the recording button and grants microphone permission in Chrome.

## Data Collection

This app does not sell recordings or send them to analytics services. Optional Google Drive uploads transmit recordings and filenames only after the user authorizes Google Drive and requests an upload or enables automatic upload.

## Audio Data

Audio is processed locally in the browser. Recordings and pending uploads are kept in page memory. Automatic upload is off by default; when enabled by the user, it uploads the chosen MP3 or WebM after recording stops. Refreshing or closing the page discards pending files, so download a backup before leaving.

## Local Storage

The app stores local preferences in the browser, including file naming, saved links, copy preference, start date, automatic MP3 download, the public Google OAuth client ID, cloud folder name, upload format and automatic upload toggle. Settings are not synchronized across devices or browser origins.

## Network Access

Without a configured authorization backend, the web version loads Google's Identity Services library from `accounts.google.com` only when the user requests a connection. With a backend, OAuth requests also go to the configured Cloudflare Worker and Google. The Chrome extension uses Chrome's Identity API instead. Audio uploads go directly to `www.googleapis.com`; the authorization backend does not receive recordings. The "open links" feature still opens links configured by the user or listed in `links.txt`.

## Google Drive

Google Drive is optional and requests only `drive.file`, for files and folders created by this app. It does not request access to the entire Drive. Google processes OAuth and API requests under its own policies.

Browser access tokens, account information, upload sessions and pending audio stay in page memory and are never committed to the source repository. The app displays the connected account's name, email address and Google-hosted profile photo; loading the photo sends a request to Google's image host with no referrer. If no photo is available, a name initial is shown. The app stores only connection preferences, including the backend address and a flag to restore the connection, in local storage.

The optional Cloudflare Worker stores the account profile and AES-GCM encrypted access/refresh tokens in a per-browser Durable Object. The encryption key and Google Client Secret are Worker secrets. A Secure, HttpOnly, Partitioned cookie identifies a browser session for up to 30 days. JavaScript cannot read this cookie. The backend uses Google's refresh token to renew short-lived authorization automatically; it sends only a short-lived access token and profile to the allowed web origin over HTTPS. Expired sessions are deleted. Authorization revocation, Google policy limits or clearing cookies can require reconnection. Without this backend, web authorization is temporary. Chrome extension authorization is managed by Chrome's identity token cache.

## Configuration Import

OAuth JSON is read and parsed locally. Only the public client ID is retained; the complete file and all other fields are discarded. Service account keys are not supported. Do not submit configuration JSON or recordings to the public source repository.

## Disconnecting

Disconnect clears this page's authorization, disables automatic upload and asks the backend to delete this browser's stored tokens and session cookie. If the request fails, the app remembers the pending logout and retries it on the next open instead of restoring authorization. Disconnecting does not delete uploaded recordings or revoke sessions on other browsers. To revoke the app's Google account grant everywhere, use Google's third-party app access settings. Existing uploaded files can be managed in Google Drive.

