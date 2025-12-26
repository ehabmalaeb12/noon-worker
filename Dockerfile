FROM mcr.microsoft.com/playwright:v1.41.2-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
