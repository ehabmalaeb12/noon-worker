# Playwright base image (includes Chromium + dependencies)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose port (Render uses $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
