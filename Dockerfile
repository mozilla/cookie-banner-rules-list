FROM node:14-slim

WORKDIR /app

COPY ./package.json ./package.json
RUN npm install --no-package-lock && \
  npm cache clear --force

COPY ./update_remote_settings_records.mjs ./update_remote_settings_records.mjs
COPY ./version.json ./version.json

CMD ["npm", "run", "ingest"]
