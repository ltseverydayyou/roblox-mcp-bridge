#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"
MANAGER_HOME="$HOME/.roblox-mcp-manager"
REPO_DIR="$HOME/roblox-mcp-bridge"
TUNNEL_BIN="$MANAGER_HOME/tunnel-client"
BRIDGE_PID="$MANAGER_HOME/bridge.pid"
TUNNEL_PID="$MANAGER_HOME/tunnel.pid"
BRIDGE_LOG="$MANAGER_HOME/bridge.log"
TUNNEL_LOG="$MANAGER_HOME/tunnel.log"
REPOSITORY_DEFAULT="https://github.com/ltseverydayyou/roblox-mcp-bridge.git"

mkdir -p "$MANAGER_HOME"

log() {
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

valid_port() {
    [[ "${1:-}" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 ))
}

valid_profile() {
    [[ "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]]
}

valid_tunnel_id() {
    [[ "${1:-}" =~ ^tunnel_[A-Za-z0-9]+$ ]]
}

pid_matches() {
    local pid_file="$1"
    local expected="$2"
    [[ -f "$pid_file" ]] || return 1
    local pid
    pid="$(tr -dc '0-9' < "$pid_file")"
    [[ -n "$pid" && -r "/proc/$pid/cmdline" ]] || return 1
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq -- "$expected"
}

stop_managed_process() {
    local pid_file="$1"
    local expected="$2"
    local label="$3"
    if ! pid_matches "$pid_file" "$expected"; then
        rm -f "$pid_file"
        log "$label is already stopped."
        return
    fi
    local pid
    pid="$(tr -dc '0-9' < "$pid_file")"
    log "Stopping $label (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
    log "$label stopped."
}

install_packages() {
    log "Updating Termux packages..."
    pkg update -y
    log "Installing Git, Node.js, curl, jq, and unzip..."
    if ! pkg install -y git nodejs-lts curl jq unzip; then
        log "nodejs-lts was unavailable; falling back to nodejs."
        pkg install -y git nodejs curl jq unzip
    fi
    command -v git >/dev/null || fail "Git installation failed."
    command -v node >/dev/null || fail "Node.js installation failed."
    command -v npm >/dev/null || fail "npm installation failed."
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    (( major >= 18 )) || fail "Node.js 18 or newer is required; installed $(node --version)."
    log "Runtime ready: $(node --version), Git $(git --version | awk '{print $3}')."
}

install_bridge() {
    local repository="${1:-$REPOSITORY_DEFAULT}"
    local branch="${2:-main}"
    [[ "$repository" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]] || fail "Repository must be an HTTPS GitHub repository."
    [[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Invalid branch name."
    install_packages
    if [[ -d "$REPO_DIR/.git" ]]; then
        log "Existing bridge found; updating it."
        git -C "$REPO_DIR" fetch --prune origin
        git -C "$REPO_DIR" checkout "$branch"
        git -C "$REPO_DIR" pull --ff-only origin "$branch"
    elif [[ -e "$REPO_DIR" ]]; then
        fail "$REPO_DIR exists but is not a Git checkout. Move or remove it in Termux first."
    else
        log "Cloning Roblox MCP Bridge..."
        git clone --branch "$branch" --single-branch "$repository" "$REPO_DIR"
    fi
    build_bridge
}

build_bridge() {
    [[ -f "$REPO_DIR/package.json" ]] || fail "Bridge repository is not installed."
    log "Installing bridge dependencies..."
    (cd "$REPO_DIR" && npm install --ignore-scripts)
    log "Building the bridge..."
    (cd "$REPO_DIR" && npm run build)
    [[ -f "$REPO_DIR/dist/index.js" ]] || fail "Build completed without dist/index.js."
    log "Roblox MCP Bridge v$(node -p "require('$REPO_DIR/package.json').version") is ready."
}

update_bridge() {
    local branch="${1:-main}"
    [[ -d "$REPO_DIR/.git" ]] || fail "Install the bridge first."
    [[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Invalid branch name."
    log "Checking GitHub for bridge updates..."
    git -C "$REPO_DIR" fetch --prune origin
    git -C "$REPO_DIR" checkout "$branch"
    git -C "$REPO_DIR" pull --ff-only origin "$branch"
    build_bridge
}

start_bridge() {
    local port="${1:-16384}"
    valid_port "$port" || fail "Invalid bridge port."
    [[ -f "$REPO_DIR/dist/index.js" ]] || fail "Install/build the bridge first."
    if pid_matches "$BRIDGE_PID" "$REPO_DIR/dist/index.js"; then
        log "Bridge is already running."
        return
    fi
    rm -f "$BRIDGE_PID"
    command -v termux-wake-lock >/dev/null && termux-wake-lock || true
    : > "$BRIDGE_LOG"
    log "Starting bridge at http://127.0.0.1:$port/..."
    nohup env ROBLOX_MCP_HOST=127.0.0.1 ROBLOX_MCP_PORT="$port" \
        node "$REPO_DIR/dist/index.js" </dev/null >>"$BRIDGE_LOG" 2>&1 &
    echo "$!" > "$BRIDGE_PID"
    sleep 1
    pid_matches "$BRIDGE_PID" "$REPO_DIR/dist/index.js" || {
        tail -n 50 "$BRIDGE_LOG" >&2 || true
        fail "Bridge exited during startup."
    }
    log "Bridge started (PID $(cat "$BRIDGE_PID"))."
}

install_tunnel() {
    install_packages
    local machine asset_pattern api asset_url checksum_url asset_name tmp expected actual
    machine="$(uname -m)"
    case "$machine" in
        aarch64|arm64) asset_pattern='linux-arm64\.zip$' ;;
        x86_64|amd64) asset_pattern='linux-amd64\.zip$' ;;
        *) fail "Unsupported Android CPU architecture: $machine" ;;
    esac
    api="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: roblox-mcp-manager-android' 'https://api.github.com/repos/openai/tunnel-client/releases/latest')"
    asset_url="$(printf '%s' "$api" | jq -r --arg pattern "$asset_pattern" '.assets[] | select(.name | test($pattern)) | .browser_download_url' | head -n 1)"
    checksum_url="$(printf '%s' "$api" | jq -r '.assets[] | select(.name == "SHA256SUMS.txt") | .browser_download_url' | head -n 1)"
    [[ -n "$asset_url" && "$asset_url" != null ]] || fail "No compatible official tunnel-client asset was published."
    [[ -n "$checksum_url" && "$checksum_url" != null ]] || fail "The release has no checksum file; refusing an unverified download."
    asset_name="${asset_url##*/}"
    tmp="$(mktemp -d "$MANAGER_HOME/tunnel-install.XXXXXX")"
    trap "rm -rf '$tmp'" EXIT
    log "Downloading official OpenAI $asset_name..."
    curl -fL "$asset_url" -o "$tmp/$asset_name"
    curl -fL "$checksum_url" -o "$tmp/SHA256SUMS.txt"
    expected="$(awk -v name="$asset_name" '$0 ~ name"$" {print $1; exit}' "$tmp/SHA256SUMS.txt" | tr 'A-F' 'a-f')"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "No valid published checksum was found for $asset_name."
    actual="$(sha256sum "$tmp/$asset_name" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || fail "Tunnel-client SHA-256 verification failed."
    unzip -q "$tmp/$asset_name" -d "$tmp/extracted"
    asset="$(find "$tmp/extracted" -type f -name tunnel-client -print -quit)"
    [[ -n "$asset" ]] || fail "The verified archive did not contain tunnel-client."
    cp "$asset" "$TUNNEL_BIN"
    chmod 700 "$TUNNEL_BIN"
    "$TUNNEL_BIN" version >/dev/null 2>&1 || "$TUNNEL_BIN" --version >/dev/null 2>&1 || fail "The official Linux tunnel binary cannot execute on this Android build."
    rm -rf "$tmp"
    log "OpenAI tunnel-client installed and checksum verified."
}

configure_tunnel() {
    local profile="${1:-roblox-executor}"
    local tunnel_id="${2:-}"
    local port="${3:-16384}"
    valid_profile "$profile" || fail "Invalid tunnel profile name."
    valid_tunnel_id "$tunnel_id" || fail "Tunnel ID must look like tunnel_ followed by letters and numbers."
    valid_port "$port" || fail "Invalid bridge port."
    [[ -x "$TUNNEL_BIN" ]] || install_tunnel
    [[ -f "$REPO_DIR/dist/index.js" ]] || fail "Install/build the bridge first."
    local mcp_command
    mcp_command="node \"$REPO_DIR/dist/index.js\" --host 127.0.0.1 --port $port"
    log "Configuring tunnel profile $profile..."
    "$TUNNEL_BIN" init --force --sample sample_mcp_stdio_local --profile "$profile" --tunnel-id "$tunnel_id" --mcp-command "$mcp_command"
    log "Tunnel profile configured."
}

doctor_tunnel() {
    local profile="${1:-roblox-executor}"
    valid_profile "$profile" || fail "Invalid tunnel profile name."
    [[ -x "$TUNNEL_BIN" ]] || fail "Install tunnel-client first."
    local runtime_key=""
    IFS= read -r runtime_key || true
    [[ -n "$runtime_key" ]] || fail "Runtime API key is required."
    export CONTROL_PLANE_API_KEY="$runtime_key"
    runtime_key=""
    "$TUNNEL_BIN" doctor --profile "$profile" --explain
    unset CONTROL_PLANE_API_KEY
}

start_tunnel() {
    local profile="${1:-roblox-executor}"
    valid_profile "$profile" || fail "Invalid tunnel profile name."
    [[ -x "$TUNNEL_BIN" ]] || fail "Install tunnel-client first."
    if pid_matches "$TUNNEL_PID" "$TUNNEL_BIN"; then
        log "Tunnel is already running."
        return
    fi
    local runtime_key=""
    IFS= read -r runtime_key || true
    [[ -n "$runtime_key" ]] || fail "Runtime API key is required."
    rm -f "$TUNNEL_PID"
    : > "$TUNNEL_LOG"
    command -v termux-wake-lock >/dev/null && termux-wake-lock || true
    log "Starting tunnel profile $profile..."
    nohup env CONTROL_PLANE_API_KEY="$runtime_key" "$TUNNEL_BIN" run --profile "$profile" \
        </dev/null >>"$TUNNEL_LOG" 2>&1 &
    echo "$!" > "$TUNNEL_PID"
    runtime_key=""
    sleep 1
    pid_matches "$TUNNEL_PID" "$TUNNEL_BIN" || {
        tail -n 80 "$TUNNEL_LOG" >&2 || true
        fail "Tunnel exited during startup."
    }
    log "Tunnel started (PID $(cat "$TUNNEL_PID"))."
}

print_status() {
    local port="${1:-16384}"
    valid_port "$port" || fail "Invalid bridge port."
    local local_version="not-installed" remote_version="unknown" node_version="missing" git_version="missing"
    command -v node >/dev/null && node_version="$(node --version)"
    command -v git >/dev/null && git_version="$(git --version | awk '{print $3}')"
    if [[ -f "$REPO_DIR/package.json" ]]; then
        local_version="$(node -p "require('$REPO_DIR/package.json').version" 2>/dev/null || printf unknown)"
    fi
    if command -v curl >/dev/null; then
        remote_version="$(curl -fsSL --max-time 8 'https://raw.githubusercontent.com/ltseverydayyou/roblox-mcp-bridge/main/package.json' 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
        [[ -n "$remote_version" ]] || remote_version="unknown"
    fi
    local bridge_running=false tunnel_running=false bridge_healthy=false tunnel_ready=false update_available=false
    pid_matches "$BRIDGE_PID" "$REPO_DIR/dist/index.js" && bridge_running=true
    pid_matches "$TUNNEL_PID" "$TUNNEL_BIN" && tunnel_running=true
    [[ -x "$TUNNEL_BIN" ]] && tunnel_ready=true
    [[ "$local_version" != "not-installed" && "$remote_version" != "unknown" && "$local_version" != "$remote_version" ]] && update_available=true
    if command -v curl >/dev/null && curl -fsS --max-time 2 "http://127.0.0.1:$port/api/status" >/dev/null 2>&1; then
        bridge_healthy=true
    fi
    printf 'MANAGER_STATUS_BEGIN\n'
    printf 'node=%s\n' "$node_version"
    printf 'git=%s\n' "$git_version"
    printf 'localVersion=%s\n' "$local_version"
    printf 'remoteVersion=%s\n' "$remote_version"
    printf 'updateAvailable=%s\n' "$update_available"
    printf 'bridgeRunning=%s\n' "$bridge_running"
    printf 'bridgeHealthy=%s\n' "$bridge_healthy"
    printf 'tunnelInstalled=%s\n' "$tunnel_ready"
    printf 'tunnelRunning=%s\n' "$tunnel_running"
    printf 'MANAGER_STATUS_END\n'
}

case "${1:-help}" in
    install) shift; install_bridge "$@" ;;
    update) shift; update_bridge "$@" ;;
    build) build_bridge ;;
    bridge-start) shift; start_bridge "$@" ;;
    bridge-stop) stop_managed_process "$BRIDGE_PID" "$REPO_DIR/dist/index.js" "bridge" ;;
    tunnel-install) install_tunnel ;;
    tunnel-configure) shift; configure_tunnel "$@" ;;
    tunnel-doctor) shift; doctor_tunnel "$@" ;;
    tunnel-start) shift; start_tunnel "$@" ;;
    tunnel-stop) stop_managed_process "$TUNNEL_PID" "$TUNNEL_BIN" "tunnel" ;;
    status) shift; print_status "$@" ;;
    bridge-logs) tail -n 160 "$BRIDGE_LOG" 2>/dev/null || log "No bridge log yet." ;;
    tunnel-logs) tail -n 160 "$TUNNEL_LOG" 2>/dev/null || log "No tunnel log yet." ;;
    *)
        printf '%s\n' 'Commands: install update build bridge-start bridge-stop tunnel-install tunnel-configure tunnel-doctor tunnel-start tunnel-stop status bridge-logs tunnel-logs'
        ;;
esac
