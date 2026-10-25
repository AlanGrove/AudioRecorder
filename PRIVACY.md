# Privacy Policy

Audio Recorder records audio only after the user clicks the recording button and grants microphone permission in Chrome.

## Data Collection

This app does not sell recordings or send them to analytics services. Optional Google Drive uploads transmit recordings and filenames only after the user authorizes Google Drive and requests an upload or enables automatic upload.

## Audio Data

Audio is processed locally in the browser. Recordings and pending uploads are kept in page memory. Automatic upload is off by default; when enabled by the user, it uploads the chosen MP3 or WebM after recording stops. Refreshing or closing the page discards pending files, so download a backup before leaving.

## Local Storage

The app stores local preferences in the browser, including file naming, saved links, copy preference, start date, automatic MP3 download, the public Google OAuth client ID, cloud folder name, upload format and automatic upload toggle. Settings are not synchronized across devices or browser origins.

## Network Access

The web version loads Google's Identity Services library from `accounts.google.com` only when the user requests a connection. The Chrome extension uses Chrome's Identity API instead. Authorized Drive requests go to `www.googleapis.com`. There is no developer upload server. The "open links" feature still opens links configured by the user or listed in `links.txt`.

## Google Drive

Google Drive is optional and requests only `drive.file`, for files and folders created by this app. It does not request access to the entire Drive. Google processes OAuth and API requests under its own policies.

OAuth authorization, account display name and permission identifier, upload sessions and pending audio stay in page memory; they are not written to browser storage or sent to the source repository. Authorization can expire and then requires reconnection.

## Configuration Import

OAuth JSON is read and parsed locally. Only the public client ID is retained; the complete file and all other fields are discarded. Service account keys are not supported. Do not submit configuration JSON or recordings to the public source repository.

## Disconnecting

Disconnect clears this page's authorization and disables automatic upload. It does not delete uploaded recordings. To revoke the app's Google account grant, use Google's third-party app access settings. Existing uploaded files can be managed in Google Drive.

