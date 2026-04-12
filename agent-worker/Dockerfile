# Memo agent worker — polls Supabase job_runs and runs Claude Agent SDK jobs.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p /tmp/memo-workspaces && chown -R node:node /tmp/memo-workspaces

COPY src ./src

USER node

CMD ["npm", "start"]
