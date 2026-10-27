# Privacy Policy

Audio Recorder records audio only after the user clicks the recording button and grants microphone permission in Chrome. Device enumeration on page load does not request microphone access; device names may remain hidden until permission is granted. The selected input is used for the next recording, and switching inputs is disabled while recording.

## Data Collection

This app does not sell recordings or send them to analytics services. Optional Google Drive uploads transmit recordings and filenames only after the user authorizes Google Drive and requests an upload or enables automatic upload.

## Audio Data

Audio is processed locally in the browser. Audio is also checkpointed locally during recording, aiming for about two-second batches of complete MP3 frames and raw WebM chunks. Draft metadata contains filenames, recording parameters, start time and committed audio duration. These backups remain after an interrupted recording until recovered or explicitly deleted. Recovery creates an MP3 of the saved portion and does not resume recording or upload audio automatically; raw interrupted WebM backups are not guaranteed to play. Completed MP3 and WebM recordings are saved in IndexedDB in the current browser, together with filenames, creation times, sizes and uploaded file IDs/account permission IDs. The recording list can play, download, upload or clear these local copies. Automatic upload is off by default; when enabled by the user, it uploads the chosen MP3 or WebM after recording stops. Refreshing stops the in-memory upload queue; successfully saved recordings remain in the list for manual retry. Local storage failure is reported so the user can download a backup. Clearing the saved-recording list deletes those local copies and link records only; interrupted backups and Google Drive files remain. Interrupted backups can be deleted separately with confirmation. Clearing site data, closing a private browsing session or browser storage eviction can remove recordings.

## Local Storage

The app stores local preferences in the browser, including the selected microphone device ID, file naming, copy preference, start date, automatic MP3 download, the public Google OAuth client ID, cloud folder name, upload format and automatic upload toggle. Settings are not synchronized across devices or browser origins.

## Network Access

Without a configured authorization backend, the web version loads Google's Identity Services library from `accounts.google.com` only when the user requests a connection. With a backend, OAuth requests also go to the configured Cloudflare Worker and Google. The Chrome extension uses Chrome's Identity API instead. Audio uploads go directly to `www.googleapis.com`; the authorization backend does not receive recordings.

## Google Drive

Google Drive is optional and requests only `drive.file`, for files and folders created by this app. It does not request access to the entire Drive. Google processes OAuth and API requests under its own policies.

Browser access tokens, connected account profile and resumable upload URLs stay in page memory. Saved recordings and their cloud file/account permission IDs remain locally in IndexedDB. Pending upload metadata also records the selected format and folder; reconnecting checks existing cloud file IDs and sizes to restore completed upload status without sending the audio again. Incomplete uploads require the user to click Continue upload. Credentials and recordings are never committed to the source repository. The app displays the connected account's name, email address and Google-hosted profile photo; loading the photo sends a request to Google's image host with no referrer. If no photo is available, a name initial is shown. The app stores only connection preferences, including the backend address and a flag to restore the connection, in local storage.

The optional Cloudflare Worker stores the account profile and AES-GCM encrypted access/refresh tokens in a per-browser Durable Object. The encryption key and Google Client Secret are Worker secrets. A Secure, HttpOnly, Partitioned cookie identifies a browser session for up to 30 days. JavaScript cannot read this cookie. The backend uses Google's refresh token to renew short-lived authorization automatically; it sends only a short-lived access token and profile to the allowed web origin over HTTPS. Expired sessions are deleted. Authorization revocation, Google policy limits or clearing cookies can require reconnection. Without this backend, web authorization is temporary. Chrome extension authorization is managed by Chrome's identity token cache.

## Configuration Import

OAuth JSON is read and parsed locally. Only the public client ID is retained; the complete file and all other fields are discarded. Service account keys are not supported. Do not submit configuration JSON or recordings to the public source repository.

## Disconnecting

Disconnect clears this page's authorization, disables automatic upload and asks the backend to delete this browser's stored tokens and session cookie. If the request fails, the app remembers the pending logout and retries it on the next open instead of restoring authorization. Disconnecting does not delete uploaded recordings or revoke sessions on other browsers. To revoke the app's Google account grant everywhere, use Google's third-party app access settings. Existing uploaded files can be managed in Google Drive.

