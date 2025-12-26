# Use Playwright's official image that bundles browsers so it runs on Cloud Run / Render
FROM mcr.microsoft.com/playwright:focal

# Create app dir
WORKDIR /usr/src/app

# Copy package + install (playwright image already has node and playwright)
COPY package.json package-lock.json* ./

# Install (npm ci is fine if package-lock exists, otherwise npm install)
RUN npm install --unsafe-perm

# Copy code
COPY . .

# Expose port
EXPOSE 8080

# Set environment (optional)
ENV PORT 8080

# Start
CMD ["node", "index.js"]
