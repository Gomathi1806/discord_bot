FROM node:20-slim

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Hugging Face Spaces runs as non-root user
RUN useradd -m botuser && chown -R botuser /app
USER botuser

CMD ["node", "index.js"]
