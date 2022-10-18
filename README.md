# `cookie-banner-rules-list` -> RemoteSettings

Rules List for how Firefox's Automated Cookie Banner Preference Manager is to interact with banners on a site by site basis

The script from this repo publishes the latest cookie-banner-rules-list.json and updates the associated collection in RemoteSettings:

When running the script, logs are emitted to stdout indicate if the collection was updated, and if so, provide a short summary of the modifications, and ultimately ask for a data review of those changes (unless `ENVIRONMENT` is set to `dev`, in which case changes are automatically published)
