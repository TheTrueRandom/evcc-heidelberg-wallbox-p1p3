FROM node:24-slim
WORKDIR /app
COPY package.json .
COPY package-lock.json .
COPY src ./src
RUN npm ci
ENTRYPOINT ["node", "src/index.js"]
