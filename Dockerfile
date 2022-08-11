FROM node:14-slim

# Install dependencies, but don't generate lock files as we want to always fetch
# the lastest cookie-banner-rules-list.
COPY package.json ./
RUN npm install --no-package-lock && \
    npm cache clear --force

# Copy the script
COPY update_remote_settings_records.mjs ./

# And run it
CMD ["npm", "run", "ingest"]

