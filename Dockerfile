# Single container with frontend + backend
# Build: docker build -t tracefinity .
# Run: docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key tracefinity

FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV NEXT_PUBLIC_API_URL=
RUN npm run build

FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    nodejs \
    npm \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# backend
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

# frontend (built)
COPY --from=frontend-build /frontend/.next ./.next
COPY --from=frontend-build /frontend/public ./public
COPY --from=frontend-build /frontend/package*.json ./
COPY --from=frontend-build /frontend/node_modules ./node_modules

# storage directory
RUN mkdir -p /app/storage/uploads /app/storage/processed /app/storage/outputs

# supervisor config
COPY <<EOF /etc/supervisor/conf.d/tracefinity.conf
[supervisord]
nodaemon=true
user=root

[program:backend]
command=uvicorn app.main:app --host 127.0.0.1 --port 8000
directory=/app/backend
environment=STORAGE_PATH="/app/storage",CORS_ORIGINS='["http://localhost:3000"]'
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:frontend]
command=npm start
directory=/app
environment=PORT="3000",BACKEND_URL="http://127.0.0.1:8000"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF

EXPOSE 3000

ENV GOOGLE_API_KEY=""
ENV STORAGE_PATH=/app/storage

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/tracefinity.conf"]
