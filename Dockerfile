FROM node:22-slim
WORKDIR /app
COPY package*.json ./
# better-sqlite3 ships prebuilt binaries, but npm ci still synthesizes `node-gyp rebuild`
# for it (npm/cli#9837), which needs Python + make that slim images lack. No dependency
# has a real install script, so skipping scripts is safe.
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
COPY integrations ./integrations
ENV WORKBOARD_HOST=0.0.0.0 WORKBOARD_DB=/data/workboard.db
EXPOSE 5054
VOLUME /data
CMD ["node", "src/cli.js", "serve"]
