# Seer Dashboard Deployment

Deploy the Seer dashboard to your home server with Docker + Tailscale HTTPS.

## Prerequisites

- Docker installed on your server
- Tailscale connected
- Tailscale HTTPS enabled (`tailscale up --https`)

## Deployment Steps

### 1. Build the dashboard locally

```bash
cd /path/to/seer
bun run build:dashboard
```

### 2. Copy files to your server

```bash
# Copy the docker folder
scp -r docker/ yourserver:/path/to/seer-dashboard/

# Copy the built dashboard
scp -r dist/dashboard/ yourserver:/path/to/seer-dashboard/docker/dashboard/
```

### 3. Start the container

On your server:
```bash
cd /path/to/seer-dashboard
docker compose up -d
```

Or import into Dockge.

### 4. Set up Tailscale Serve

```bash
# Proxy port 8080 to HTTPS
tailscale serve https / http://localhost:8080
```

Your dashboard is now at: `https://your-machine.tailnet-name.ts.net/`

### 5. Update the extension manifest

In `manifest.json`, add your Tailscale domain to the bridge content script:

```json
{
  "content_scripts": [
    {
      "matches": ["https://your-machine.tailnet-name.ts.net/*"],
      "js": ["src/content/seer-dev-bridge.ts"],
      "run_at": "document_start"
    }
  ]
}
```

Then rebuild and reload the extension.

## Updating the Dashboard

```bash
# Locally
bun run build:dashboard

# Copy to server
scp -r dist/dashboard/ yourserver:/path/to/seer-dashboard/docker/dashboard/

# The nginx container will serve new files immediately (no restart needed)
```
