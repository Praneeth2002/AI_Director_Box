# 🚀 Hosting AI Director's Box on Google Cloud

This guide outlines the production architecture for deploying the AI Director's Box on GCP.

## 🏗️ Architecture Overview

- **Frontend**: Next.js hosted on **Firebase Hosting** (or **Cloud Run** for SSR).
- **Backend API**: Express on **Cloud Run** (Containerized with FFmpeg).
- **Storage**: **Google Cloud Storage (GCS)** Buckets for uploads, clips, and audio.
- **AI Services**: Vertex AI (Gemini, Imagen) & Google Cloud Text-to-Speech.
- **Security**: **Secret Manager** for API keys and Service Accounts for IAM permissions.

---

## 1. Backend: Cloud Run (Containers)

Cloud Run is ideal because it scales to zero when not in use and handles high-burst analysis well.

### 🐳 Dockerfile Requirements:
You must include `ffmpeg` in your backend container.
```dockerfile
FROM node:20
RUN apt-get update && apt-get install -y ffmpeg
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "start"]
```

### 🛰️ WebSocket Note:
Enable **Session Affinity** in Cloud Run settings to ensure WebSocket connections remain stable.

---

## 2. Media: Google Cloud Storage (GCS)

Local file storage (`/uploads`) won't work in Cloud Run because the filesystem is ephemeral.

- **Step A**: Create a bucket `your-project-media`.
- **Step B**: Update `clipExtractor.ts` and [TheCommentator.ts](file:///c:/Sources/AI_Director_Box/backend/src/agents/TheCommentator.ts) to upload results directly to GCS instead of `fs.writeFileSync`.
- **Step C**: Use Signed URLs or Public Read access for the frontend to play the videos/audio.

---

## 3. Frontend: Firebase Hosting

The fastest way to serve your Next.js frontend globally.

```bash
npm install -g firebase-tools
firebase init hosting
firebase deploy
```

---

## 4. Setup Checklist

1. **Enable APIs**:
   - Vertex AI API
   - Cloud Text-to-Speech API
   - Cloud Run API
   - Secret Manager API
2. **Service Account**:
   - Create a service account with `Vertex AI User` and `Storage Object Admin` roles.
   - Attach this account to your Cloud Run service.
3. **IAM Permissions**:
   - Ensure the service account has permission to read/write to your GCS bucket.

---

## 🛠️ Recommended CI/CD

Use **Cloud Build** to automatically deploy whenever you push to your `story` branch:
1. Push to GitHub.
2. Cloud Build triggers.
3. Build Docker image → Artifact Registry.
4. Deploy to Cloud Run.
