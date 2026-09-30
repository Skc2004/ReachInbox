FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
# Install only production dependencies
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Expose API port
EXPOSE 3000

# Start command will be overridden by docker-compose for api/worker, but defaults to running both for free-tier PaaS
CMD ["npm", "run", "start:all"]
