# Stage 1: Build
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
# Install all dependencies (including dev for tsc)
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:20-slim AS runner
WORKDIR /app

# Install FFmpeg in the final runner image
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy build output and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev

EXPOSE 9090
CMD ["npm", "start"]
