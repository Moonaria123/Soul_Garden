#!/bin/bash
# ============================================
# Soul Upload - One-Click Docker Deploy Script
# ============================================
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_NAME="soul-upload"
DEFAULT_PORT=3002

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║       Soul Upload - Docker Deploy        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ------- Check prerequisites -------
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon is not running.${NC}"
    echo "Please start Docker Desktop or the Docker service."
    exit 1
fi

echo -e "${GREEN}  Docker is ready.${NC}"

# Check docker compose
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo -e "${YELLOW}  Docker Compose not found, will use docker build directly.${NC}"
    COMPOSE_CMD=""
fi

# ------- Configure port -------
echo -e "${YELLOW}[2/5] Configuring...${NC}"

PORT=${1:-$DEFAULT_PORT}
echo -e "${GREEN}  Port: ${PORT}${NC}"
export PORT

# ------- Stop old container -------
echo -e "${YELLOW}[3/5] Stopping old container (if any)...${NC}"

if [ -n "$COMPOSE_CMD" ]; then
    $COMPOSE_CMD down 2>/dev/null || true
else
    docker stop $APP_NAME 2>/dev/null || true
    docker rm $APP_NAME 2>/dev/null || true
fi
echo -e "${GREEN}  Done.${NC}"

# ------- Build -------
echo -e "${YELLOW}[4/5] Building Docker image (this may take a few minutes)...${NC}"

if [ -n "$COMPOSE_CMD" ]; then
    $COMPOSE_CMD build --no-cache
else
    docker build -t $APP_NAME .
fi
echo -e "${GREEN}  Build complete.${NC}"

# ------- Run -------
echo -e "${YELLOW}[5/5] Starting container...${NC}"

if [ -n "$COMPOSE_CMD" ]; then
    $COMPOSE_CMD up -d
else
    docker run -d \
        --name $APP_NAME \
        -p ${PORT}:3000 \
        -e NODE_ENV=production \
        -e NEXT_TELEMETRY_DISABLED=1 \
        --restart unless-stopped \
        $APP_NAME
fi

# ------- Wait for health -------
echo -e "${CYAN}  Waiting for app to start...${NC}"
for i in $(seq 1 30); do
    if curl -sf http://localhost:${PORT}/ > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

if curl -sf http://localhost:${PORT}/ > /dev/null 2>&1; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Deployment Successful!           ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  URL: http://localhost:${PORT}              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Useful commands:"
    echo -e "    View logs:   ${CYAN}docker logs -f $APP_NAME${NC}"
    echo -e "    Stop:        ${CYAN}docker stop $APP_NAME${NC}"
    echo -e "    Restart:     ${CYAN}docker restart $APP_NAME${NC}"
    echo -e "    Remove:      ${CYAN}docker rm -f $APP_NAME${NC}"
else
    echo -e "${YELLOW}  App is starting up, may need a few more seconds...${NC}"
    echo -e "  Check logs: ${CYAN}docker logs -f $APP_NAME${NC}"
    echo -e "  URL: http://localhost:${PORT}"
fi
