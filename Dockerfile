FROM node:24-slim
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm ci
COPY src ./src
ENTRYPOINT ["node", "src/index.js"]
