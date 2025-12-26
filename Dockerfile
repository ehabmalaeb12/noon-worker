# Dockerfile
FROM mcr.microsoft.com/playwright:focal

WORKDIR /usr/src/app

# Copy package files first to use cache
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app code
COPY . .

# Ensure playwright browsers installed (redundant but safe)
RUN npx playwright install --with-deps

ENV PORT 10000
EXPOSE 10000

CMD ["node", "index.js"]
