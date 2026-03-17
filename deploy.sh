#!/bin/bash
set -e # Exit on error

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
BACKEND_SERVICE="ai-director-backend"
FRONTEND_SERVICE="ai-director-frontend"
BUCKET_NAME="$PROJECT_ID-media"

echo "🚀 Starting Full Stack Deployment to $REGION..."
echo "📊 Project ID: $PROJECT_ID"
echo "👤 Active Account: $(gcloud config get-value account)"

# 1. Enable APIs (Continue even if this fails, as user might have already enabled them manually)
echo "✨ Enabling necessary APIs..."
gcloud services enable run.googleapis.com \
    containerregistry.googleapis.com \
    texttospeech.googleapis.com \
    vertexai.googleapis.com \
    storage.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com || echo "⚠️ Warning: Some APIs could not be enabled via script. Please ensure Vertex AI, Cloud Run, Cloud Build, and TTS are enabled in the GCP Console."

# 2. Setup GCS Bucket
echo "📦 Checking GCS Bucket..."
if gsutil ls -b "gs://$BUCKET_NAME" >/dev/null 2>&1; then
    echo "📦 Bucket $BUCKET_NAME already exists."
else
    echo "📦 Creating Bucket $BUCKET_NAME..."
    gsutil mb -l $REGION "gs://$BUCKET_NAME" || echo "⚠️ Bucket creation failed. It might already exist or you lack permissions."
    gsutil iam ch allUsers:objectViewer "gs://$BUCKET_NAME" || echo "⚠️ Public access setup failed."
fi

# 3. Build and Push Backend
echo "📦 Building and pushing Backend Docker image..."
if [ -d "backend" ]; then
    cd backend
    gcloud builds submit --tag "gcr.io/$PROJECT_ID/$BACKEND_SERVICE" .
    cd ..
else
    echo "❌ Error: 'backend' directory not found in $(pwd)"
    exit 1
fi

# 4. Build and Push Frontend
echo "📦 Building and pushing Frontend Docker image..."
if [ -d "frontend" ]; then
    cd frontend
    gcloud builds submit --tag "gcr.io/$PROJECT_ID/$FRONTEND_SERVICE" .
    cd ..
else
    echo "❌ Error: 'frontend' directory not found in $(pwd)"
    exit 1
fi

# 5. Deploy Backend to Cloud Run
echo "🚀 Deploying Backend to Cloud Run..."
BACKEND_URL=$(gcloud run deploy $BACKEND_SERVICE \
    --image "gcr.io/$PROJECT_ID/$BACKEND_SERVICE" \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,GCS_BUCKET_NAME=$BUCKET_NAME,NODE_ENV=production" \
    --session-affinity \
    --format 'value(status.url)')

echo "✅ Backend deployed at: $BACKEND_URL"

# 6. Deploy Frontend to Cloud Run
echo "🚀 Deploying Frontend to Cloud Run..."
# Convert https to wss for the WebSocket URL
WS_URL=$(echo $BACKEND_URL | sed 's/https/wss/')

FRONTEND_URL=$(gcloud run deploy $FRONTEND_SERVICE \
    --image "gcr.io/$PROJECT_ID/$FRONTEND_SERVICE" \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars="NEXT_PUBLIC_API_URL=$BACKEND_URL,NEXT_PUBLIC_WS_URL=$WS_URL,NODE_ENV=production" \
    --format 'value(status.url)')

echo "✅ Frontend deployed at: $FRONTEND_URL"

echo "🎉 All Done! Visit your app at: $FRONTEND_URL"
