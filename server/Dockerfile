FROM node:18-alpine

WORKDIR /app

# build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src ./src

EXPOSE 3000
CMD ["npm", "start"]
