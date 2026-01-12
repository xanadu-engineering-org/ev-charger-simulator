FROM node:20-alpine AS base
WORKDIR /app

# Install production dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY src ./src

ENV PORT=3030
EXPOSE 3030

CMD ["npm", "start"]
