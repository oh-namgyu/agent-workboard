FROM node:23-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY integrations ./integrations
ENV WORKBOARD_HOST=0.0.0.0 WORKBOARD_DB=/data/workboard.db
EXPOSE 5054
VOLUME /data
CMD ["node", "src/cli.js", "serve"]
