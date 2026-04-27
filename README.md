<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1AEweDx5ZnJrswEH3srppr8gY6tsPc9Ai

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Local mode and Google Drive mirror mode

This project now supports two storage modes:

- `Local only`: everything stays on the current computer
- `Google Drive mirror`: the app keeps working locally, but also maintains a synchronized mirror folder inside Google Drive for desktop

What gets synchronized:

- SQLite data exported from the local database
- Files from `uploads/`
- Files from `temp/`
- Frontend state stored in `localStorage` under `armi_*`

How mirror mode works:

- The app keeps its working data locally
- A mirror copy is written into a Google Drive desktop folder chosen by the user
- The app compares manifests using timestamp + digest
- If the mirror is newer, the app can pull it back into the local machine
- If the local machine is newer, the app can push changes to the mirror

Safety protections included:

- Local restore points are created before pulling data from the mirror
- Removed mirror files are moved to a safety trash inside `.armi-sync/trash`
- Atomic writes are used for manifests and copied files
- If files referenced by the mirror manifest are missing, sync stops instead of overwriting healthy data

Recommended setup:

1. Install Google Drive for desktop
2. Sign in with the Google account that will hold the mirror
3. In the app, choose `Google Drive mirror` mode
4. Select or paste a mirror path such as `C:\Users\TuUsuario\Google Drive\ARMI Sync`

Important note:

- Data should not be stored inside the application installation folder
- The mirror folder is separate from the installed app and is meant only for synchronized copies
