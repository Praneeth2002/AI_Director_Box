# 🚀 Hosting AI Director's Box on Google Cloud

This guide outlines the production architecture and provides automation scripts for deploying the AI Director's Box on GCP.

## 🏗️ Architecture Overview

- **Frontend**: Next.js hosted on **Firebase Hosting** (or **Cloud Run** for SSR).
- **Backend API**: Express on **Cloud Run** (Containerized with FFmpeg).
- **Storage**: **Google Cloud Storage (GCS)** Buckets for uploads, clips, and audio.
- **AI Services**: Vertex AI (Gemini, Imagen) & Google Cloud Text-to-Speech.

---

## ⚡ Automated Deployment

We have provided a `deploy.sh` script in the `backend/` directory to automate the build and deployment process.

### Prerequisites:
1.  **Google Cloud SDK** installed and authenticated (`gcloud auth login`).
2.  **Project ID** set (`gcloud config set project YOUR_PROJECT_ID`).

### Execution:
```bash
chmod +x deploy.sh
./deploy.sh
```

This script will:
- Enable Cloud Run, Artifact Registry, Vertex AI, and TTS APIs.
- Build the container image using **Cloud Build**.
- Deploy the service to **Cloud Run** with **Session Affinity** enabled (required for WebSockets).

---

## 🐳 Backend: Dockerization

The backend uses a specialized `Dockerfile` to ensure FFmpeg is available in the Cloud Run environment.

```dockerfile
# (See backend/Dockerfile for full content)
FROM node:20
RUN apt-get update && apt-get install -y ffmpeg
...
```

---

## 🛰️ Frontend Configuration

The frontend is configured to use environment variables for API and WebSocket URLs.

1.  **Environment Variables**: Create a `.env.local` (or set in your hosting console):
    ```env
    NEXT_PUBLIC_API_URL=https://your-backend-url.a.run.app
    NEXT_PUBLIC_WS_URL=wss://your-backend-url.a.run.app
    ```

---

## 💾 Media Persistence: Google Cloud Storage (GCS)

> [!IMPORTANT]
> Cloud Run filesystems are ephemeral. To persist uploads and AI-generated clips, you must integrate GCS.

### 🛠️ Integration Steps:

1.  **Create a Bucket**:
    ```bash
    gsutil mb gs://your-project-media
    ```

2.  **Update Backend Logic**:
    Modify `clipExtractor.ts` and `TheCommentator.ts` to use the `@google-cloud/storage` SDK.
    - **Upload**: Instead of `fs.writeFileSync`, stream files to GCS.
    - **Serve**: Use Signed URLs or make the bucket public (with caution) to provide `audioUrl` and `clipUrl` to the frontend.

3.  **Permissions**:
    The Cloud Run service account must have the `Storage Object Admin` role.

---

## 🛠️ Automated CI/CD (Optional)

Include the `cloudbuild.yaml` in your repository to automate deployments on every `git push`.

```yaml
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', 'gcr.io/$PROJECT_ID/ai-director-backend', '.']
- name: 'gcr.io/cloud-builders/docker'
  args: ['push', 'gcr.io/$PROJECT_ID/ai-director-backend']
- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  entrypoint: gcloud
  args:
  - 'run'
  - 'deploy'
  - 'ai-director-backend'
  - '--image'
  - 'gcr.io/$PROJECT_ID/ai-director-backend'
  - '--region'
  - 'us-central1'
  - '--session-affinity'
```
