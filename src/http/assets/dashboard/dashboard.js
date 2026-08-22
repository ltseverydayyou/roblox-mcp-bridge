/* ── State ────────────────────────────────────────────────── */
let selectedClientId = null;
let currentView = 'clients';
let dashboardMode = 'home'; // 'home' or 'client'
let clients = [];
let toolCallCount = 0;
let currentRelays = 0;
let currentConnected = false;
let semanticSearchEnabled = true;
let settingsProvider = 'openai';
let decompilerSettings = null;
let decompilerRuntimeAdvancedOpen = false;
const DASHBOARD_PREFERENCES_KEY = 'roblox-mcp-dashboard-preferences';
const DASHBOARD_LAST_CLIENT_KEY = 'roblox-mcp-last-client';
const DEFAULT_DASHBOARD_PREFERENCES = {
    accent: '#3b82f6',
    density: 'comfortable',
    corners: 'rounded',
    codeFontSize: 13,
    motion: true,
    wrapToolOutput: true,
    statusRefreshMs: 2000,
    scriptsRefreshMs: 5000,
    defaultClientView: 'overview',
    maxOutputChars: 6000,
    rememberClient: true
};
let dashboardPreferences = loadDashboardPreferences();
let statusRefreshTimer = null;
let scriptsRefreshTimer = null;
let rememberedClientSuppressed = false;

let startTime = Date.now();

/* ── DOM refs ────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const topbarSection = $('topbarSection');
const topbarStatus = $('topbarStatus');
const topbarRole = $('topbarRole');
const clientSelectorBtn = $('clientSelectorBtn');
const clientSelectorAvatar = $('clientSelectorAvatar');
const clientSelectorName = $('clientSelectorName');
const clientDropdown = $('clientDropdown');
const clientDropdownSearch = $('clientDropdownSearch');
const clientDropdownList = $('clientDropdownList');
const uptimeChip = $('uptimeChip');
const updateBanner = $('updateBanner');
const updateBannerTitle = $('updateBannerTitle');
const updateBannerMessage = $('updateBannerMessage');
const updateCopyBtn = $('updateCopyBtn');
const updateDismissBtn = $('updateDismissBtn');

const viewClients = $('viewClients');
const viewOverview = $('viewOverview');
const viewTools = $('viewTools');
const viewServer = $('viewServer');
const viewSettings = $('viewSettings');
const viewServerLogs = $('viewServerLogs');
const viewScripts = $('viewScripts');
const topbarBack = $('topbarBack');
const sidebarNavHome = $('sidebarNavHome');
const sidebarNavClient = $('sidebarNavClient');

const noClientSearch = $('noClientSearch');
const noClientList = $('noClientList');
const addClientBtn = $('addClientBtn');
const addClientModal = $('addClientModal');
const addClientCloseBtn = $('addClientCloseBtn');
const addClientModalTitle = $('addClientModalTitle');
const addClientModalDesc = $('addClientModalDesc');
const addClientBody = $('addClientBody');

const toolPanel = $('toolPanel');
const toolPanelName = $('toolPanelName');
const toolPanelBody = $('toolPanelBody');
const toolPanelClose = $('toolPanelClose');
const toolRunBtn = $('toolRunBtn');
const toolPanelOutput = $('toolPanelOutput');
const toolOutputBody = $('toolOutputBody');
const semanticIndexBtn = $('semanticIndexBtn');
const semanticIndexStatus = $('semanticIndexStatus');
const scriptsFileMenu = $('scriptsFileMenu');
const scriptsCodeMenuBtn = $('scriptsCodeMenuBtn');
const scriptsCodeMenu = $('scriptsCodeMenu');
const scriptsCodeSaveBtn = $('scriptsCodeSaveBtn');
const scriptsCodeView = $('scriptsCodeView');
const scriptsExportBtn = $('scriptsExportBtn');

function normalizeDashboardPreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    const accent = /^#[0-9a-f]{6}$/i.test(source.accent || '') ? source.accent.toLowerCase() : DEFAULT_DASHBOARD_PREFERENCES.accent;
    const density = ['comfortable', 'compact'].includes(source.density) ? source.density : DEFAULT_DASHBOARD_PREFERENCES.density;
    const corners = ['rounded', 'soft', 'square'].includes(source.corners) ? source.corners : DEFAULT_DASHBOARD_PREFERENCES.corners;
    const defaultClientView = ['overview', 'scripts', 'tools'].includes(source.defaultClientView) ? source.defaultClientView : DEFAULT_DASHBOARD_PREFERENCES.defaultClientView;
    const statusRefreshMs = [1000, 2000, 5000, 10000].includes(Number(source.statusRefreshMs)) ? Number(source.statusRefreshMs) : DEFAULT_DASHBOARD_PREFERENCES.statusRefreshMs;
    const scriptsRefreshMs = [2000, 5000, 10000, 30000].includes(Number(source.scriptsRefreshMs)) ? Number(source.scriptsRefreshMs) : DEFAULT_DASHBOARD_PREFERENCES.scriptsRefreshMs;
    const codeFontSize = Math.min(18, Math.max(11, Math.round(Number(source.codeFontSize) || DEFAULT_DASHBOARD_PREFERENCES.codeFontSize)));
    const maxOutputChars = Math.min(32000, Math.max(1000, Math.round(Number(source.maxOutputChars) || DEFAULT_DASHBOARD_PREFERENCES.maxOutputChars)));
    return {
        accent,
        density,
        corners,
        codeFontSize,
        motion: source.motion !== false,
        wrapToolOutput: source.wrapToolOutput !== false,
        statusRefreshMs,
        scriptsRefreshMs,
        defaultClientView,
        maxOutputChars,
        rememberClient: source.rememberClient !== false
    };
}

function loadDashboardPreferences() {
    try {
        return normalizeDashboardPreferences(JSON.parse(localStorage.getItem(DASHBOARD_PREFERENCES_KEY) || '{}'));
    } catch {
        return { ...DEFAULT_DASHBOARD_PREFERENCES };
    }
}

function accentRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function applyDashboardPreferences() {
    const root = document.documentElement;
    const radii = {
        rounded: ['8px', '12px'],
        soft: ['5px', '8px'],
        square: ['1px', '2px']
    }[dashboardPreferences.corners];
    root.style.setProperty('--blue', dashboardPreferences.accent);
    root.style.setProperty('--blue-dim', accentRgba(dashboardPreferences.accent, 0.12));
    root.style.setProperty('--radius', radii[0]);
    root.style.setProperty('--radius-lg', radii[1]);
    root.style.setProperty('--code-font-size', `${dashboardPreferences.codeFontSize}px`);
    document.body.classList.toggle('dashboard-density-compact', dashboardPreferences.density === 'compact');
    document.body.classList.toggle('dashboard-motion-off', dashboardPreferences.motion === false);
    document.body.classList.toggle('dashboard-tool-nowrap', dashboardPreferences.wrapToolOutput === false);
}

function populateDashboardPreferenceControls() {
    if (!$('settingsAccentColor')) return;
    $('settingsAccentColor').value = dashboardPreferences.accent;
    $('settingsDensity').value = dashboardPreferences.density;
    $('settingsCorners').value = dashboardPreferences.corners;
    $('settingsCodeFontSize').value = String(dashboardPreferences.codeFontSize);
    $('settingsCodeFontSizeValue').textContent = `${dashboardPreferences.codeFontSize}px`;
    $('settingsMotion').checked = dashboardPreferences.motion;
    $('settingsWrapToolOutput').checked = dashboardPreferences.wrapToolOutput;
    $('settingsStatusRefresh').value = String(dashboardPreferences.statusRefreshMs);
    $('settingsScriptsRefresh').value = String(dashboardPreferences.scriptsRefreshMs);
    $('settingsDefaultClientView').value = dashboardPreferences.defaultClientView;
    $('settingsMaxOutputChars').value = String(dashboardPreferences.maxOutputChars);
    $('settingsRememberClient').checked = dashboardPreferences.rememberClient;
    $('settingsAccentPresets').querySelectorAll('[data-accent]').forEach(button => {
        button.classList.toggle('active', button.dataset.accent.toLowerCase() === dashboardPreferences.accent);
    });
}

function readDashboardPreferenceControls() {
    return normalizeDashboardPreferences({
        accent: $('settingsAccentColor').value,
        density: $('settingsDensity').value,
        corners: $('settingsCorners').value,
        codeFontSize: $('settingsCodeFontSize').value,
        motion: $('settingsMotion').checked,
        wrapToolOutput: $('settingsWrapToolOutput').checked,
        statusRefreshMs: $('settingsStatusRefresh').value,
        scriptsRefreshMs: $('settingsScriptsRefresh').value,
        defaultClientView: $('settingsDefaultClientView').value,
        maxOutputChars: $('settingsMaxOutputChars').value,
        rememberClient: $('settingsRememberClient').checked
    });
}

function saveDashboardPreferences(message) {
    dashboardPreferences = readDashboardPreferenceControls();
    localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(dashboardPreferences));
    if (!dashboardPreferences.rememberClient) localStorage.removeItem(DASHBOARD_LAST_CLIENT_KEY);
    applyDashboardPreferences();
    populateDashboardPreferenceControls();
    restartDashboardRefreshTimers();
    showToast(message, 'success');
}

const SHINY_LOCAL_ENDPOINT = 'http://localhost:3000/luau/decompile';
const SHINY_HOSTED_ENDPOINT = 'https://medal.upio.dev/decompile';
const BRIDGE_HOST_ENDPOINT_TOKEN = '{{BridgeHost}}';
const DEFAULT_DECOMPILER_RUNTIME = {
    adaptiveFallback: true,
    loadBalanceSlowProviders: true,
    overallTimeoutMs: 12000,
    slowAfterMs: 6000,
    cooldownMs: 60000,
    slowSuccessLimit: 3,
    timeoutLimit: 2,
    providerTimeoutsMs: {
        builtin: 8000,
        luaexpert: 10000,
        shiny: 6000,
        oracle: 15000,
        konstant: 10000,
        fission: 6000
    }
};

const decompilerProviderUi = {
    builtin: {
        label: 'Built-in decompiler',
        byline: 'Executor',
        description: 'Executor-provided decompile() function.'
    },
    luaexpert: {
        label: 'lua.expert',
        byline: 'lua.expert',
        description: 'Remote JSON decompiler.'
    },
    shiny: {
        label: 'Shiny',
        byline: 'local or hosted',
        description: 'Use a local Shiny server or the hosted Medal Server endpoint.',
        setupLabel: 'Download & setup Shiny',
        setupDescription: 'Downloads the latest Shiny release for this computer and starts the local server.'
    },
    oracle: {
        label: 'Oracle',
        byline: 'API key required',
        description: 'Paid API decompiler with configurable options.',
        purchaseUrl: 'https://discord.gg/T3HVAbzgCa'
    },
    konstant: {
        label: 'Konstant',
        byline: 'plusgiant5',
        description: 'Raw-bytecode endpoint.'
    },
    fission: {
        label: 'Fission',
        byline: 'Dottik',
        description: 'Local Fission HTTP server.',
        setupLabel: 'Download & setup Fission',
        setupDescription: 'Downloads the latest Fission server release and starts the local endpoint.'
    }
};
let decompilerDragId = null;
let decompilerDragState = null;
let decompilerModalProviderId = null;
let decompilerAdvancedOpen = true;
let decompilerSetupState = {};
let decompilerHealthRefreshInFlight = false;

function cloneDefaultDecompilerRuntime() {
    return {
        ...DEFAULT_DECOMPILER_RUNTIME,
        providerTimeoutsMs: { ...DEFAULT_DECOMPILER_RUNTIME.providerTimeoutsMs }
    };
}

function shinyMode(provider) {
    const mode = provider?.options && typeof provider.options === 'object' ? provider.options.mode : null;
    if (mode === 'local' || mode === 'hosted') return mode;
    const endpoint = typeof provider?.endpoint === 'string' ? provider.endpoint : '';
    return endpoint.includes('medal.upio.dev') ? 'hosted' : 'local';
}

function shinyEndpointForMode(mode) {
    return mode === 'hosted' ? SHINY_HOSTED_ENDPOINT : SHINY_LOCAL_ENDPOINT;
}

function isLoopbackEndpointHost(hostname) {
    const normalized = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0';
}

function endpointToBridgeHostDisplay(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint.trim()) return endpoint || '';
    if (endpoint.includes(BRIDGE_HOST_ENDPOINT_TOKEN)) return endpoint;
    try {
        const url = new URL(endpoint);
        if (!isLoopbackEndpointHost(url.hostname)) return endpoint;
        const port = url.port ? ':' + url.port : '';
        return url.protocol + '//' + BRIDGE_HOST_ENDPOINT_TOKEN + port + url.pathname + url.search + url.hash;
    } catch {
        return endpoint;
    }
}

function endpointToMcpHostValue(endpoint) {
    if (typeof endpoint !== 'string') return '';
    return endpoint
        .trim()
        .replace(/^(https?:\/\/)\{\{BridgeHost\}\}(?=[:/?#]|$)/i, '$1localhost');
}

function endpointDisplayForProvider(id, provider, endpoint) {
    if (id === 'shiny' && shinyMode(provider) === 'hosted') return endpoint || '';
    if (id === 'fission' || id === 'shiny') return endpointToBridgeHostDisplay(endpoint);
    return endpoint || '';
}

function fissionLocalEndpoint() {
    return 'http://localhost:3001/luau/decompile';
}

function setShinyMode(provider, mode, preserveCustomEndpoint = false) {
    provider.options = provider.options && typeof provider.options === 'object' && !Array.isArray(provider.options)
        ? { ...provider.options }
        : {};
    provider.options.mode = mode;
    const currentEndpoint = typeof provider.endpoint === 'string' ? provider.endpoint.trim() : '';
    if (!preserveCustomEndpoint || !currentEndpoint) {
        provider.endpoint = shinyEndpointForMode(mode);
    }
}

function updateCodeOverflowHint() {
    if (!scriptsCodeView) return;
    const hasOverflow = scriptsCodeView.scrollWidth > scriptsCodeView.clientWidth;
    const atEnd = scriptsCodeView.scrollLeft + scriptsCodeView.clientWidth >= scriptsCodeView.scrollWidth - 8;
    scriptsCodeView.classList.toggle('has-overflow-x', hasOverflow && !atEnd);
}

// Dynamic right-edge overflow hint
if (scriptsCodeView) scriptsCodeView.addEventListener('scroll', updateCodeOverflowHint);
window.addEventListener('resize', updateCodeOverflowHint);

let semanticIndexJobId = null;

/* ── Helpers ──────────────────────────────────────────────── */
function getInitials(name) { return name.slice(0, 2).toUpperCase(); }

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeFull(date) {
    const d = date instanceof Date ? date : new Date(date);
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const day = String(d.getDate()).padStart(2, '0');
    return `${mon} ${day} ${formatTime(d)}`;
}

function avatarHtml(userId, name, size) {
    const sz = size || 28;
    if (userId && userId > 0) {
        return `<img src="/api/avatar?userId=${userId}" onerror="this.parentNode.textContent='${getInitials(name)}'" style="width:${sz}px;height:${sz}px;object-fit:cover;">`;
    }
    return getInitials(name);
}

function transportClass(t) { return t === 'ws' ? 'transport-ws' : 'transport-http'; }

/* ── Uptime ──────────────────────────────────────────────── */
function updateUptime() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const str = h + ':' + m + ':' + s;
    uptimeChip.textContent = str;
    const tu = $('tileUptime');
    if (tu) tu.textContent = str;
}
setInterval(updateUptime, 1000);

/* ── View switching ──────────────────────────────────────── */
const allViews = () => [viewClients, viewOverview, viewTools, viewServer, viewSettings, viewServerLogs, viewScripts];

function setSidebarMode(mode) {
    dashboardMode = mode;
    sidebarNavHome.style.display = mode === 'home' ? 'flex' : 'none';
    sidebarNavClient.style.display = mode === 'client' ? 'flex' : 'none';
    topbarBack.style.display = mode === 'client' ? 'inline-flex' : 'none';
}

function showView(name) {
    const prevView = currentView;
    currentView = name;
    allViews().forEach(v => {
        v.style.display = 'none';
        v.classList.remove('view--entering');
    });
    const labels = {clients:'Clients',server:'Server','server-logs':'Logs',settings:'Settings',overview:'Overview',tools:'Tools',scripts:'Scripts'};
    topbarSection.textContent = labels[name] || name;

    let targetView = null;
    if (name === 'clients') { targetView = viewClients; viewClients.style.display = 'flex'; }
    else if (name === 'server') { targetView = viewServer; viewServer.style.display = 'block'; renderServerGraph(); renderOverviewClients(); }
    else if (name === 'server-logs') { targetView = viewServerLogs; viewServerLogs.style.display = 'block'; fetchServerLogs(); }
    else if (name === 'settings') { targetView = viewSettings; viewSettings.style.display = 'block'; loadSettings(); }
    else if (name === 'overview') { targetView = viewOverview; viewOverview.style.display = 'block'; }
    else if (name === 'tools') { 
        targetView = viewTools;
        viewTools.style.display = 'block'; 
        if (!activeTool) selectTool('script-grep');
    }
    else if (name === 'scripts') { 
        targetView = viewScripts;
        viewScripts.style.display = 'block'; 
        fetchScripts(); 
        if (scriptsData.length > 0 && !scriptsViewingFile) renderScriptsBrowser();
    }

    // Only animate on actual navigation, not on re-entry to the same view
    if (targetView && prevView !== name) {
        targetView.classList.add('view--entering');
        targetView.addEventListener('animationend', () => {
            targetView.classList.remove('view--entering');
        }, { once: true });
    }

    const activeNav = dashboardMode === 'home' ? sidebarNavHome : sidebarNavClient;
    activeNav.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.classList.toggle('sidebar-item--active', btn.dataset.view === name);
    });
}

function bindSidebarNav(nav) {
    nav.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.addEventListener('click', () => showView(btn.dataset.view));
    });
}
bindSidebarNav(sidebarNavHome);
bindSidebarNav(sidebarNavClient);

topbarBack.addEventListener('click', () => {
    rememberedClientSuppressed = true;
    selectedClientId = null;
    resetScriptsState();
    clientSelectorName.textContent = 'Select Client';
    clientSelectorAvatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
    setSidebarMode('home');
    showView('clients');
    renderNoClientList('');
});

/* ── Client selector dropdown ────────────────────────────── */
clientSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clientDropdown.classList.toggle('open');
    if (clientDropdown.classList.contains('open')) {
        clientDropdownSearch.value = '';
        clientDropdownSearch.focus();
        renderDropdownClients('');
    }
});

document.addEventListener('click', (e) => {
    if (!clientDropdown.contains(e.target) && !clientSelectorBtn.contains(e.target)) {
        clientDropdown.classList.remove('open');
    }
});

clientDropdownSearch.addEventListener('input', () => {
    renderDropdownClients(clientDropdownSearch.value.toLowerCase());
});

function renderDropdownClients(filter) {
    const filtered = clients.filter(c => !filter || c.username.toLowerCase().includes(filter) || c.placeName.toLowerCase().includes(filter));
    if (filtered.length === 0) {
        clientDropdownList.innerHTML = '<div class="client-dropdown-empty">No clients found</div>';
        return;
    }
    clientDropdownList.innerHTML = filtered.map(c => {
        const active = c.clientId === selectedClientId ? ' active' : '';
        return `<div class="client-dropdown-item${active}" data-cid="${c.clientId}">
            <div class="client-dropdown-item-avatar">${avatarHtml(c.userId, c.username)}</div>
            <div class="client-dropdown-item-info">
                <div class="client-dropdown-item-name">${c.username}</div>
                <div class="client-dropdown-item-place">${c.placeName}</div>
            </div>
            <span class="client-dropdown-item-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    clientDropdownList.querySelectorAll('.client-dropdown-item').forEach(el => {
        el.addEventListener('click', () => {
            selectClient(el.dataset.cid);
            clientDropdown.classList.remove('open');
        });
    });
}

/* ── No-client picker list ───────────────────────────────── */
noClientSearch.addEventListener('input', () => {
    renderNoClientList(noClientSearch.value.toLowerCase());
});

function renderNoClientList(filter) {
    const filtered = clients.filter(c => !filter || c.username.toLowerCase().includes(filter) || c.placeName.toLowerCase().includes(filter));
    if (filtered.length === 0) {
        noClientList.innerHTML = `<div class="no-client-empty">
            <div class="no-client-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></div>
            <span>No clients connected</span>
        </div>`;
        return;
    }
    noClientList.innerHTML = filtered.map(c => {
        return `<div class="no-client-item" data-cid="${c.clientId}">
            <div class="no-client-item-avatar">${avatarHtml(c.userId, c.username, 32)}</div>
            <span class="no-client-item-name">${c.username}</span>
            <span class="no-client-item-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    noClientList.querySelectorAll('.no-client-item').forEach(el => {
        el.addEventListener('click', () => selectClient(el.dataset.cid));
    });
}

/* ── Add client setup wizard ─────────────────────────────── */
let clientSetupData = null;
let addClientMode = 'intro';
let addClientTarget = 'roblox';
let addClientGuideOpen = false;
let addClientAdminPrompt = null;
let addClientOutput = '';
let addClientAutoexecOutput = '';
let addClientAutoexecSelected = null;
let addClientDirectBridge = 'localhost:16384';
let addClientBridgeOverrides = {
    localNetwork: '',
    authorizedMachines: '',
};

const SETUP_ICONS = {
    current: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-laptop-icon lucide-laptop"><path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/></svg>',
    network: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-router-icon lucide-router"><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18H6"/><path d="M10.01 18H10"/><path d="M15 10v4"/><path d="M17.84 7.17a4 4 0 0 0-5.66 0"/><path d="M20.66 4.34a8 8 0 0 0-11.31 0"/></svg>',
    tailscale: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe-lock-icon lucide-globe-lock"><path d="M15.686 15A14.5 14.5 0 0 1 12 22a14.5 14.5 0 0 1 0-20 10 10 0 1 0 9.542 13"/><path d="M2 12h8.5"/><path d="M20 6V4a2 2 0 1 0-4 0v2"/><rect width="8" height="5" x="14" y="6" rx="1"/></svg>',
    roblox: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(12 12 12)"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>',
    mcp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 4 7l8 4 8-4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></svg>',
    chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
};

const ADD_CLIENT_TARGETS = {
    roblox: {
        title: 'Roblox client',
        shortTitle: 'Roblox',
        codeTitle: 'Roblox connector',
        action: 'Paste this in Roblox. It connects the game client only.',
        description: 'Runs the Luau connector in Roblox. This does not relay host-side MCP tools.',
    },
    mcp: {
        title: 'MCP relay',
        shortTitle: 'MCP relay',
        codeTitle: 'MCP config diff',
        action: 'Add these entries to that MCP server args array on the other machine.',
        description: 'Connects another MCP instance. This can relay host-side tools like screenshot-window.',
    },
};

function normalizeDashboardBridgeUrl(value) {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'localhost:16384';
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed;
    try {
        const url = new URL(withProtocol);
        if (!url.port) url.port = '16384';
        return url.hostname + ':' + url.port;
    } catch {
        return 'localhost:16384';
    }
}

function buildDashboardLoaderSnippet(bridgeUrl) {
    const normalized = normalizeDashboardBridgeUrl(bridgeUrl);
    const loaderAddress = normalized === 'localhost:16384' ? '127.0.0.1:16384' : normalized;
    return 'getgenv().BridgeURL = "' + loaderAddress + '"\n' +
        'getgenv().DisableWebSocket = true\n\n' +
        'if getgenv().MCP_AutoReconnect then\n' +
        '    return\n' +
        'end\n\n' +
        'getgenv().MCP_AutoReconnect = true\n\n' +
        'while getgenv().MCP_AutoReconnect do\n' +
        '    local Success, Source = pcall(function()\n' +
        '        return game:HttpGet("http://" .. getgenv().BridgeURL .. "/script.luau")\n' +
        '    end)\n\n' +
        '    if not Success or type(Source) ~= "string" or Source == "" then\n' +
        '        warn("[Roblox MCP] Connector download failed: " .. tostring(Source))\n' +
        '        task.wait(2)\n' +
        '        continue\n' +
        '    end\n\n' +
        '    local Bridge, CompileError = loadstring(Source)\n\n' +
        '    if not Bridge then\n' +
        '        warn("[Roblox MCP] Connector compile failed: " .. tostring(CompileError))\n' +
        '        task.wait(2)\n' +
        '        continue\n' +
        '    end\n\n' +
        '    getgenv().MCP_Loaded = false\n\n' +
        '    local Ran, RuntimeError = pcall(Bridge)\n' +
        '    if not Ran then\n' +
        '        warn("[Roblox MCP] Connector stopped: " .. tostring(RuntimeError))\n' +
        '    end\n\n' +
        '    getgenv().MCP_Loaded = false\n\n' +
        '    task.wait(2)\n' +
        'end';
}

function buildDashboardMcpRelaySnippet(bridgeUrl) {
    const relayUrl = 'http://' + normalizeDashboardBridgeUrl(bridgeUrl);
    return '{\n' +
        '  "mcpServers": {\n' +
        '    "roblox-mcp": {\n' +
        '      "args": [\n' +
        '        "...existing args",\n' +
        '+       "--baseurl",\n' +
        '+       "' + relayUrl + '"\n' +
        '      ]\n' +
        '    }\n' +
        '  }\n' +
        '}';
}

function buildDashboardMcpRelayCopySnippet(bridgeUrl) {
    const relayUrl = 'http://' + normalizeDashboardBridgeUrl(bridgeUrl);
    return '"--baseurl",\n"' + relayUrl + '"';
}

function makeConnector(bridgeUrl) {
    const normalized = normalizeDashboardBridgeUrl(bridgeUrl);
    return { bridgeUrl: normalized, loaderSnippet: buildDashboardLoaderSnippet(normalized) };
}

function getConnectorFor(mode) {
    if (mode === 'directBridge') return makeConnector(addClientDirectBridge);

    if (mode === 'currentMachine') {
        return clientSetupData?.connectors?.currentMachine || makeConnector('localhost:16384');
    }

    const override = addClientBridgeOverrides[mode];
    if (override) return makeConnector(override);

    const connector = clientSetupData?.connectors?.[mode];
    if (connector) return connector;

    return null;
}

function getTargetCopy() {
    return ADD_CLIENT_TARGETS[addClientTarget] || ADD_CLIENT_TARGETS.roblox;
}

function copyText(text, label) {
    navigator.clipboard.writeText(text).then(() => {
        showToast((label || 'Text') + ' copied', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

function shortenHomePath(path) {
    if (!path) return '';
    const home = path.replace(/^\/Users\/[^/]+/, '~');
    if (home.length <= 56) return home;
    const parts = home.split('/');
    const file = parts.pop() || '';
    const tail = parts.slice(-2).join('/');
    return (tail ? '~/' + tail : '~') + '/' + file;
}

function renderAddClientLoading() {
    addClientBody.innerHTML = '<div class="add-client-status">Loading setup options...</div>';
}

async function refreshClientSetupData() {
    const res = await fetch('/api/client-setup');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load setup options');
    clientSetupData = data;
    return data;
}

function openAddClientModal() {
    addClientMode = 'intro';
    addClientTarget = 'roblox';
    addClientGuideOpen = false;
    addClientAdminPrompt = null;
    addClientOutput = '';
    addClientAutoexecOutput = '';
    addClientAutoexecSelected = null;
    addClientDirectBridge = 'localhost:16384';
    addClientModal.classList.add('open');
    renderAddClientLoading();
    refreshClientSetupData()
        .then(renderAddClient)
        .catch((error) => {
            addClientBody.innerHTML = '<div class="add-client-status add-client-status--error">' + escapeHtml(error.message || error) + '</div>';
        });
}

function closeAddClientModal() {
    addClientModal.classList.remove('open');
}

function renderAddClient() {
    if (addClientMode === 'intro') renderAddClientIntro();
    else if (addClientMode === 'choices') renderAddClientChoices();
    else if (addClientMode === 'directBridge') renderDirectBridge();
    else if (addClientMode === 'currentMachine') renderConnectorChoice('currentMachine');
    else if (addClientMode === 'localNetwork') renderConnectorChoice('localNetwork');
    else if (addClientMode === 'authorizedMachines') renderAuthorizedMachines();
    else renderAddClientIntro();
    updateAddClientModalHeader();
    syncAutoexecSelectAllUi();
}

function updateAddClientModalHeader() {
    if (!addClientModalTitle || !addClientModalDesc) return;

    let title = 'Connect';
    let desc = '';
    let descMono = false;

    if (addClientMode === 'intro') {
        desc = 'Roblox or another MCP instance.';
    } else if (addClientMode === 'choices') {
        desc = getTargetCopy().title;
    } else if (addClientMode === 'currentMachine') {
        title = 'This machine';
        desc = getConnectorFor('currentMachine')?.bridgeUrl || 'localhost:16384';
        descMono = true;
    } else if (addClientMode === 'localNetwork') {
        title = 'Local network';
        const connector = getConnectorFor('localNetwork');
        desc = connector?.bridgeUrl || 'Set bridge address';
        descMono = Boolean(connector?.bridgeUrl);
    } else if (addClientMode === 'authorizedMachines') {
        title = 'Tailscale';
        const ts = clientSetupData?.tailscale || {};
        const connector = getConnectorFor('authorizedMachines');
        if (connector?.bridgeUrl) {
            desc = connector.bridgeUrl + (ts.ip ? ' · connected' : '');
            descMono = true;
        } else if (!ts.installed) {
            desc = 'Not installed on this host';
        } else {
            desc = 'Not connected yet';
        }
    } else if (addClientMode === 'directBridge') {
        title = 'Manual bridge';
        desc = addClientDirectBridge || 'host:16384';
        descMono = true;
    }

    addClientModalTitle.textContent = title;
    addClientModalDesc.textContent = desc;
    addClientModalDesc.hidden = !desc;
    addClientModalDesc.classList.toggle('add-client-modal-desc--mono', descMono);
}

function renderAddClientIntro() {
    addClientBody.innerHTML = '<div class="add-client-panel">' +
        renderSafetyWarning() +
        '<div class="add-client-intent-grid">' +
        renderTargetChoice('roblox', SETUP_ICONS.roblox) +
        renderTargetChoice('mcp', SETUP_ICONS.mcp) +
        '</div>' +
        '<div class="add-client-subactions">' +
        '<button class="add-client-link-btn" data-action="skip-bridge">Enter bridge address manually</button>' +
        '</div>' +
        '</div>';
}

function renderSafetyWarning() {
    return '<div class="add-client-warning">' +
        '<strong>Keep port 16384 private.</strong>' +
        '<span>Use localhost, your local network, SSH, or Tailscale. Do not port-forward this relay to the public internet.</span>' +
        '</div>';
}

function renderTargetChoice(target, icon) {
    const copy = ADD_CLIENT_TARGETS[target];
    return '<button class="add-client-intent" data-action="choose-target" data-target="' + escapeHtml(target) + '">' +
        '<span class="add-client-intent-icon">' + icon + '</span>' +
        '<span class="add-client-intent-title">' + escapeHtml(copy.title) + '</span>' +
        '<span class="add-client-intent-desc">' + escapeHtml(copy.description) + '</span>' +
        '<span class="add-client-intent-meta">' + escapeHtml(copy.action) + '</span>' +
        '</button>';
}

function renderAddClientChoices() {
    const lan = clientSetupData?.lanIp ? clientSetupData.lanIp + ':16384' : 'Manual address';
    const tail = clientSetupData?.tailscale?.ip ? clientSetupData.tailscale.ip + ':16384' : 'Tailscale address';
    const target = getTargetCopy();
    const routeCopy = addClientTarget === 'mcp'
        ? {
            current: 'Another MCP process is on this computer.',
            network: 'Another MCP host is on this LAN.',
            tailscale: 'Use Tailscale for an approved MCP relay.',
        }
        : {
            current: 'Roblox is on this computer.',
            network: 'Roblox is on another device on this network.',
            tailscale: 'Use Tailscale for approved Roblox devices.',
        };

    addClientBody.innerHTML = '<div class="add-client-panel">' +
        '<div class="add-client-top-row">' + renderBackButton() + renderSkipBridgeButton() + '</div>' +
        '<div class="add-client-selected-target">' +
        '<span>' + escapeHtml(target.title) + '</span>' +
        '<button class="add-client-link-btn" data-action="change-target">Change</button>' +
        '</div>' +
        '<div class="add-client-options">' +
        renderAddClientOption('currentMachine', SETUP_ICONS.current, 'This machine', routeCopy.current, 'localhost:16384') +
        renderAddClientOption('localNetwork', SETUP_ICONS.network, 'Local network', routeCopy.network, lan) +
        renderAddClientOption('authorizedMachines', SETUP_ICONS.tailscale, 'Authorized machines', routeCopy.tailscale, tail) +
        '</div>' +
        '</div>';
}

function renderAddClientOption(mode, icon, title, desc, meta) {
    return '<button class="add-client-option" data-action="choose-setup" data-mode="' + escapeHtml(mode) + '">' +
        '<span class="add-client-option-icon">' + icon + '</span>' +
        '<span class="add-client-option-text"><span class="add-client-option-title">' + escapeHtml(title) + '</span><span class="add-client-option-desc">' + escapeHtml(desc) + '</span></span>' +
        '<span class="add-client-option-meta">' + escapeHtml(meta) + ' ' + SETUP_ICONS.chevron + '</span>' +
        '</button>';
}

function renderBackButton() {
    return '<button class="add-client-back" data-action="setup-back">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>' +
        'Back</button>';
}

function renderSkipBridgeButton() {
    return '<button class="add-client-link-btn" data-action="skip-bridge">Skip to connector</button>';
}

function renderTargetSwitch() {
    return '<div class="add-client-target-tabs" role="group" aria-label="Connector type">' +
        '<button class="add-client-target-tab' + (addClientTarget === 'roblox' ? ' active' : '') + '" data-action="set-target" data-target="roblox">Roblox</button>' +
        '<button class="add-client-target-tab' + (addClientTarget === 'mcp' ? ' active' : '') + '" data-action="set-target" data-target="mcp">MCP relay</button>' +
        '</div>';
}

function renderConnectorChoice(mode) {
    const connector = getConnectorFor(mode);
    const defaultBridge = mode === 'currentMachine'
        ? 'localhost:16384'
        : (clientSetupData?.lanIp ? clientSetupData.lanIp + ':16384' : '');
    const needsManual = mode === 'localNetwork';

    addClientBody.innerHTML = '<div class="add-client-panel">' +
        '<div class="add-client-top-row">' + renderBackButton() + renderSkipBridgeButton() + '</div>' +
        renderTargetSwitch() +
        (needsManual ? renderBridgeInput(mode, defaultBridge, 'Bridge address', true) : '') +
        (connector ? renderConnectorCode(connector) : '<p class="add-client-hint add-client-hint--warn">Enter an address to generate the connector.</p>') +
        (connector && mode === 'currentMachine' && addClientTarget === 'roblox' ? renderAutoexecSetup(connector) : '') +
        '</div>';
}

function renderDirectBridge() {
    const connector = getConnectorFor('directBridge');
    addClientBody.innerHTML = '<div class="add-client-panel">' +
        '<div class="add-client-top-row">' + renderBackButton() + '</div>' +
        renderSafetyWarning() +
        renderTargetSwitch() +
        renderBridgeInput('directBridge', addClientDirectBridge, 'Bridge address', true) +
        renderConnectorCode(connector) +
        '</div>';
}

function renderBridgeInput(mode, fallback, label, compact) {
    const value = mode === 'directBridge'
        ? addClientDirectBridge
        : (addClientBridgeOverrides[mode] || fallback || '');
    const placeholder = mode === 'authorizedMachines' ? 'Tailscale address (host:16384)' : 'host:16384';
    const fieldClass = compact ? 'add-client-field add-client-field--compact' : 'add-client-field';
    const labelHtml = compact
        ? '<label class="sr-only" for="addClientBridgeInput">' + escapeHtml(label) + '</label>'
        : '<label for="addClientBridgeInput">' + escapeHtml(label) + '</label>';
    return '<div class="' + fieldClass + '">' +
        labelHtml +
        '<div class="add-client-input-row">' +
        '<input class="add-client-input" id="addClientBridgeInput" data-mode="' + escapeHtml(mode) + '" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '">' +
        '<button class="add-client-btn" data-action="apply-bridge">Apply</button>' +
        '</div></div>';
}

function renderConnectorCode(connector) {
    const target = getTargetCopy();
    const code = addClientTarget === 'mcp'
        ? buildDashboardMcpRelaySnippet(connector.bridgeUrl)
        : connector.loaderSnippet;
    const copyCode = addClientTarget === 'mcp'
        ? buildDashboardMcpRelayCopySnippet(connector.bridgeUrl)
        : code;
    const codeHtml = addClientTarget === 'mcp'
        ? code.split('\n').map(line => {
            const cls = line.startsWith('+') ? ' add-client-code-line--add' : '';
            return '<span class="add-client-code-line' + cls + '">' + escapeHtml(line) + '</span>';
        }).join('')
        : escapeHtml(code);

    return '<div class="add-client-result">' +
        '<div class="add-client-code-wrap">' +
        '<div class="add-client-code-head">' +
        '<span class="add-client-code-label">' + escapeHtml(target.codeTitle) + '</span>' +
        '<button class="add-client-btn add-client-btn--ghost" data-action="copy-connector">Copy</button>' +
        '</div>' +
        '<pre class="add-client-code" id="addClientConnectorCode" data-copy-text="' + escapeHtml(copyCode) + '">' + codeHtml + '</pre>' +
        '</div>' +
        '<p class="add-client-hint add-client-hint--inline">' + escapeHtml(target.action) + '</p>' +
        '</div>';
}

function getAutoexecTargets() {
    const status = clientSetupData?.autoexec || {};
    return Array.isArray(status.detectedTargets) ? status.detectedTargets : [];
}

function ensureAutoexecSelection(targets) {
    const ids = targets.map((target) => target.id).filter(Boolean);
    if (addClientAutoexecSelected === null) {
        addClientAutoexecSelected = new Set(ids);
        return;
    }
    const valid = new Set(ids);
    addClientAutoexecSelected = new Set([...addClientAutoexecSelected].filter((id) => valid.has(id)));
    if (!addClientAutoexecSelected.size && ids.length) {
        addClientAutoexecSelected = new Set(ids);
    }
}

function allAutoexecSelected(targets) {
    const ids = targets.map((target) => target.id).filter(Boolean);
    return ids.length > 0 && ids.every((id) => addClientAutoexecSelected.has(id));
}

function someAutoexecSelected(targets) {
    const ids = targets.map((target) => target.id).filter(Boolean);
    return ids.some((id) => addClientAutoexecSelected.has(id)) && !allAutoexecSelected(targets);
}

function getSelectedAutoexecIds(targets) {
    const valid = new Set(targets.map((target) => target.id).filter(Boolean));
    return [...addClientAutoexecSelected].filter((id) => valid.has(id));
}

function syncAutoexecSelectAllUi() {
    const selectAll = $('addClientAutoexecSelectAll');
    if (!selectAll) return;
    const targets = getAutoexecTargets();
    selectAll.checked = allAutoexecSelected(targets);
    selectAll.indeterminate = someAutoexecSelected(targets);
}

function renderAutoexecTargetRow(target) {
    const path = target.scriptPath || target.folder || '';
    const installed = target.installedPath || (target.installed ? target.scriptPath : '');
    const id = target.id || '';
    const checked = addClientAutoexecSelected.has(id);
    return '<label class="add-client-autoexec-target' + (checked ? ' is-selected' : '') + '">' +
        '<input class="add-client-autoexec-check" type="checkbox" data-autoexec-id="' + escapeHtml(id) + '"' + (checked ? ' checked' : '') + '>' +
        '<div class="add-client-autoexec-target-main">' +
        '<span class="add-client-autoexec-name">' + escapeHtml(target.name || 'Executor') + '</span>' +
        (path ? '<span class="add-client-autoexec-path" title="' + escapeHtml(path) + '">' + escapeHtml(shortenHomePath(path)) + '</span>' : '') +
        '</div>' +
        (installed ? '<span class="add-client-autoexec-note">Existing script</span>' : '') +
        '</label>';
}

function renderAutoexecSelectAll(targets) {
    const all = allAutoexecSelected(targets);
    return '<label class="add-client-autoexec-select-all">' +
        '<input class="add-client-autoexec-check" type="checkbox" id="addClientAutoexecSelectAll"' + (all ? ' checked' : '') + '>' +
        '<span>Select all</span>' +
        '</label>';
}

function renderAutoexecInstallButton(connector, targets) {
    const selectedCount = getSelectedAutoexecIds(targets).length;
    const bridge = escapeHtml(connector.bridgeUrl);
    let label = 'Install selected';
    if (selectedCount === targets.length && targets.length > 1) label = 'Install to all executors';
    else if (selectedCount === 1) label = 'Install to 1 executor';
    else if (selectedCount > 1) label = 'Install to ' + selectedCount + ' executors';
    return '<button class="add-client-btn add-client-btn--primary" data-action="write-autoexec" data-bridge="' + bridge + '"' +
        (selectedCount ? '' : ' disabled') + '>' + escapeHtml(label) + '</button>';
}

function renderAutoexecSetup(connector) {
    const targets = getAutoexecTargets();

    if (!targets.length) {
        return '<div class="add-client-autoexec">' +
            '<div class="add-client-autoexec-head">' +
            '<span class="add-client-autoexec-title">Auto-install</span>' +
            '<span class="add-client-autoexec-desc">Install the connector into your executor autoexec folder.</span>' +
            '</div>' +
            '<p class="add-client-hint add-client-hint--warn">No supported autoexec folder was detected. Known macOS and Windows executor paths are checked automatically.</p>' +
            '</div>';
    }

    ensureAutoexecSelection(targets);

    return '<div class="add-client-autoexec">' +
        '<div class="add-client-autoexec-head">' +
        '<span class="add-client-autoexec-title">Auto-install</span>' +
        '<span class="add-client-autoexec-desc">Choose executors, then install the connector to their autoexec folders.</span>' +
        '</div>' +
        '<div class="add-client-autoexec-list">' +
        renderAutoexecSelectAll(targets) +
        '<div class="add-client-autoexec-targets">' + targets.map(renderAutoexecTargetRow).join('') + '</div>' +
        '</div>' +
        '<div class="add-client-actions">' +
        renderAutoexecInstallButton(connector, targets) +
        '</div>' +
        (addClientAutoexecOutput ? '<pre class="add-client-output">' + escapeHtml(addClientAutoexecOutput) + '</pre>' : '') +
        '</div>';
}

function renderTailscaleCallout(otherMachine, canAuto, ts) {
    if (!canAuto) {
        return '<p class="add-client-callout add-client-callout--warn">Open this dashboard locally to run Tailscale setup.</p>';
    }
    if (!ts.installed) {
        return '<p class="add-client-callout add-client-callout--warn">Install Tailscale here and on ' + escapeHtml(otherMachine) + '.</p>';
    }
    if (!ts.ip) {
        return '<p class="add-client-callout add-client-callout--warn">Sign in to Tailscale on this host.</p>';
    }
    return '<p class="add-client-callout">Also install Tailscale on ' + escapeHtml(otherMachine) + '.</p>';
}

function renderAuthorizedMachines() {
    const connector = getConnectorFor('authorizedMachines');
    const ts = clientSetupData?.tailscale || {};
    const canAuto = clientSetupData?.isLocalRequest !== false;
    const otherMachine = addClientTarget === 'mcp' ? 'the other MCP host' : 'the Roblox device';
    const targetVerb = addClientTarget === 'mcp' ? 'update the MCP config with the relay diff' : 'paste the Roblox connector';

    addClientBody.innerHTML = '<div class="add-client-panel add-client-panel--compact">' +
        '<div class="add-client-top-row">' + renderBackButton() + renderSkipBridgeButton() + '</div>' +
        renderTargetSwitch() +
        renderTailscaleCallout(otherMachine, canAuto, ts) +
        (addClientAdminPrompt ? renderAdminPrompt() : '') +
        '<div class="add-client-actions add-client-actions--compact">' +
        '<button class="add-client-btn add-client-btn--primary" data-action="tailscale-auto"' + (canAuto ? '' : ' disabled') + '>Set up</button>' +
        '<button class="add-client-btn" data-action="tailscale-refresh">Refresh</button>' +
        '<button class="add-client-btn" data-action="toggle-guide">' + (addClientGuideOpen ? 'Hide guide' : 'Guide') + '</button>' +
        '</div>' +
        renderBridgeInput('authorizedMachines', ts.ip ? ts.ip + ':16384' : '', 'Tailscale address', true) +
        (connector ? renderConnectorCode(connector) : '<p class="add-client-hint add-client-hint--warn">Connect Tailscale or enter an address above.</p>') +
        (addClientOutput ? '<pre class="add-client-output">' + escapeHtml(addClientOutput) + '</pre>' : '') +
        (addClientGuideOpen ? renderTailscaleGuide(otherMachine, targetVerb) : '') +
        '</div>';
}

function renderAdminPrompt() {
    return '<div class="add-client-callout add-client-callout--warn">' +
        '<div>' + escapeHtml(addClientAdminPrompt.message) + '</div>' +
        (addClientAdminPrompt.error ? '<div>' + escapeHtml(addClientAdminPrompt.error) + '</div>' : '') +
        '<div class="add-client-actions add-client-actions--compact add-client-actions--nested">' +
        '<button class="add-client-btn add-client-btn--primary" data-action="tailscale-admin">Continue</button>' +
        '<button class="add-client-btn" data-action="toggle-guide">Guide</button>' +
        '</div></div>';
}

function renderTailscaleGuide(otherMachine, targetVerb) {
    const downloadUrl = clientSetupData?.guide?.downloadUrl || 'https://tailscale.com/download';
    const cliUrl = clientSetupData?.guide?.cliUrl || 'https://tailscale.com/docs/reference/tailscale-cli';
    const linuxCommand = clientSetupData?.guide?.linuxInstallCommand || 'curl -fsSL https://tailscale.com/install.sh | sh';
    return '<ol class="add-client-guide">' +
        '<li>Install Tailscale on this MCP host from <a href="' + escapeHtml(downloadUrl) + '" target="_blank" rel="noreferrer">tailscale.com/download</a>.</li>' +
        '<li>Install Tailscale on ' + escapeHtml(otherMachine) + ' too.</li>' +
        '<li>Sign in to the same Tailscale account on both machines.</li>' +
        '<li>On Linux, the official install command is <code>' + escapeHtml(linuxCommand) + '</code>.</li>' +
        '<li>Use <a href="' + escapeHtml(cliUrl) + '" target="_blank" rel="noreferrer">the Tailscale CLI</a> to check status if needed.</li>' +
        '<li>Return here, refresh status, then ' + escapeHtml(targetVerb) + ' on the authorized machine.</li>' +
        '</ol>';
}

async function runClientSetupAction(action, elevated = false) {
    addClientOutput = elevated ? 'Waiting for administrator permission...' : 'Running setup...';
    addClientAdminPrompt = null;
    renderAuthorizedMachines();

    try {
        const res = await fetch('/api/client-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, elevated }),
        });
        const data = await res.json();
        if (!res.ok || (data.error && !data.needsAdmin && !data.needsManualInstall && !data.needsInstall)) {
            throw new Error(data.error || 'Setup failed');
        }

        addClientOutput = [data.output, data.error].filter(Boolean).join('\n') || (data.ok ? 'Done.' : '');

        if (data.needsAdmin) {
            addClientAdminPrompt = {
                action: data.adminAction || action,
                message: data.adminMessage || 'Administrator permission is required.',
                error: data.error || '',
            };
        } else if (data.needsManualInstall) {
            addClientGuideOpen = true;
            addClientOutput = data.error || 'Manual install is required on this machine.';
        } else if (data.needsInstall) {
            addClientOutput = data.error || 'Tailscale needs to be installed first.';
            addClientGuideOpen = true;
        }

        await refreshClientSetupData();
        renderAuthorizedMachines();
    } catch(e) {
        addClientOutput = e.message || 'Setup failed';
        addClientGuideOpen = true;
        renderAuthorizedMachines();
    }
}

if (addClientBtn) addClientBtn.addEventListener('click', openAddClientModal);
if (addClientCloseBtn) addClientCloseBtn.addEventListener('click', closeAddClientModal);
if (addClientModal) {
    addClientModal.addEventListener('click', (e) => {
        if (e.target === addClientModal) closeAddClientModal();
    });
}
if (addClientBody) {
    addClientBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'choose-target') {
            addClientTarget = btn.dataset.target || 'roblox';
            addClientMode = 'choices';
            renderAddClientChoices();
        } else if (action === 'change-target') {
            addClientMode = 'intro';
            addClientGuideOpen = false;
            addClientAdminPrompt = null;
            addClientOutput = '';
            renderAddClientIntro();
        } else if (action === 'set-target') {
            addClientTarget = btn.dataset.target || 'roblox';
            renderAddClient();
        } else if (action === 'skip-bridge') {
            addClientMode = 'directBridge';
            addClientAdminPrompt = null;
            addClientOutput = '';
            renderDirectBridge();
        } else if (action === 'choose-setup') {
            addClientMode = btn.dataset.mode || 'choices';
            addClientAdminPrompt = null;
            addClientOutput = '';
            addClientAutoexecOutput = '';
            addClientAutoexecSelected = null;
            renderAddClient();
        } else if (action === 'setup-back') {
            if (addClientMode === 'choices' || addClientMode === 'directBridge') {
                addClientMode = 'intro';
                addClientGuideOpen = false;
            } else {
                addClientMode = 'choices';
            }
            addClientAdminPrompt = null;
            addClientOutput = '';
            addClientAutoexecOutput = '';
            addClientAutoexecSelected = null;
            renderAddClient();
        } else if (action === 'copy-connector') {
            const codeEl = $('addClientConnectorCode');
            const code = codeEl?.dataset.copyText || codeEl?.textContent || '';
            if (code) copyText(code, addClientTarget === 'mcp' ? 'MCP config diff' : 'Connector script');
        } else if (action === 'write-autoexec') {
            const bridgeUrl = btn.dataset.bridge || 'localhost:16384';
            const targets = getAutoexecTargets();
            const selectedIds = getSelectedAutoexecIds(targets);
            if (!selectedIds.length) {
                showToast('Select at least one executor', 'error');
                return;
            }
            addClientAutoexecOutput = 'Writing autoexec loader...';
            renderAddClient();
            try {
                const res = await fetch('/api/client-setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'write-autoexec',
                        bridgeUrl,
                        autoexecTargetIds: selectedIds,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || 'Could not write autoexec loader');
                addClientAutoexecOutput = 'Wrote:\n' + (data.written || []).map(item => {
                    if (typeof item === 'string') return item;
                    const previous = item.previousPath && item.previousPath !== item.scriptPath
                        ? ' (existing connector detected at ' + item.previousPath + ')'
                        : '';
                    return item.scriptPath + previous;
                }).join('\n');
                await refreshClientSetupData();
                showToast('Autoexec loader installed', 'success');
            } catch (error) {
                addClientAutoexecOutput = error.message || 'Could not write autoexec loader';
                showToast('Autoexec install failed', 'error');
            }
            renderAddClient();
        } else if (action === 'apply-bridge') {
            const input = $('addClientBridgeInput');
            if (input) {
                if (input.dataset.mode === 'directBridge') {
                    addClientDirectBridge = input.value.trim() || 'localhost:16384';
                } else {
                    addClientBridgeOverrides[input.dataset.mode] = input.value.trim();
                }
                renderAddClient();
            }
        } else if (action === 'tailscale-auto') {
            await runClientSetupAction('tailscale-auto', false);
        } else if (action === 'tailscale-admin') {
            await runClientSetupAction(addClientAdminPrompt?.action || 'tailscale-auto', true);
        } else if (action === 'tailscale-refresh') {
            await refreshClientSetupData();
            renderAuthorizedMachines();
        } else if (action === 'toggle-guide') {
            addClientGuideOpen = !addClientGuideOpen;
            renderAuthorizedMachines();
        }
    });

    addClientBody.addEventListener('change', (e) => {
        const input = e.target;
        if (!input?.classList?.contains('add-client-autoexec-check')) return;

        const targets = getAutoexecTargets();
        if (input.id === 'addClientAutoexecSelectAll') {
            const ids = targets.map((target) => target.id).filter(Boolean);
            addClientAutoexecSelected = new Set(input.checked ? ids : []);
        } else {
            const id = input.dataset.autoexecId;
            if (!id) return;
            if (input.checked) addClientAutoexecSelected.add(id);
            else addClientAutoexecSelected.delete(id);
        }
        renderAddClient();
    });
}

/* ── Select client ───────────────────────────────────────── */
function selectClient(clientId) {
    if (selectedClientId !== clientId) resetScriptsState();
    rememberedClientSuppressed = false;
    selectedClientId = clientId;
    const c = clients.find(x => x.clientId === clientId);
    if (c) {
        clientSelectorName.textContent = c.username;
        clientSelectorAvatar.innerHTML = avatarHtml(c.userId, c.username, 24);
        if (dashboardPreferences.rememberClient) localStorage.setItem(DASHBOARD_LAST_CLIENT_KEY, c.username);
    }
    setSidebarMode('client');
    showView(dashboardPreferences.defaultClientView);
    updateOverview();
}

/* ── Update overview ─────────────────────────────────────── */
function updateOverview() {
    const c = clients.find(x => x.clientId === selectedClientId);
    if (!c) return;

    $('overviewUsername').textContent = c.username;
    $('overviewPlace').textContent = c.placeName;
    $('overviewClientId').textContent = c.clientId;
    $('overviewPlaceId').textContent = c.placeId || '—';
    $('overviewUserId').textContent = c.userId || '—';
    $('overviewJobId').textContent = c.jobId || '—';
    $('overviewExecutor').textContent = c.executorName || 'Unknown';
    $('overviewExecutorVersion').textContent = c.executorVersion || 'Unknown';
    $('overviewRobloxVersion').textContent = c.robloxVersion || 'Unknown';
    $('overviewPlatform').textContent = c.platform || 'Unknown';

    const oa = $('overviewAvatar');
    oa.innerHTML = avatarHtml(c.userId, c.username, 56);

    const ot = $('overviewTransport');
    ot.textContent = c.transport.toUpperCase();
    ot.className = 'overview-transport ' + transportClass(c.transport);

    $('tileTransport').textContent = c.transport === 'ws' ? 'WebSocket' : 'HTTP Polling';

    const sync = c.scriptSync || { mappedSources: 0, sourcesToMap: 0, hasFinishedMapping: false };
    const mapped = Number(sync.mappedSources) || 0;
    const processed = Number(sync.processedSources) || mapped;
    const skipped = Number(sync.skippedSources) || Math.max(0, processed - mapped);
    const total = Number(sync.sourcesToMap) || 0;
    const syncDone = sync.hasFinishedMapping === true;
    const ssv = $('scriptsSyncCount'); if (ssv) ssv.textContent = `${mapped}/${total}`;
    
    // Update Sync Progress
    const syncPerc = total > 0 ? Math.round((mapped / total) * 100) : 0;
    const spv = $('scriptsSyncPerc'); if (spv) spv.textContent = `${syncPerc}%`;
    const spf = $('syncProgressFill'); if (spf) spf.style.width = `${syncPerc}%`;

    const sss = $('scriptsSyncStatus');
    if (sss) {
        sss.textContent = syncDone ? (skipped > 0 ? 'Synced (skips)' : 'Synced') : 'Syncing';
        sss.className = 'scripts-sync-badge' + (syncDone ? ' scripts-sync-badge--synced' : '');
    }

    const oss = $('overviewScriptsSynced');
    if (oss) oss.textContent = mapped;

    if (semanticSearchEnabled === false) {
        const scv = $('scriptsChunkCount'); if (scv) scv.textContent = '0/0';
        const ipv = $('scriptsIndexPerc'); if (ipv) ipv.textContent = '0%';
        const ipf = $('indexProgressFill'); if (ipf) ipf.style.width = '0%';
        if (semanticIndexStatus) semanticIndexStatus.textContent = 'Disabled';
        if (semanticIndexBtn) semanticIndexBtn.disabled = true;
        return;
    }

    const semantic = c.semanticIndex || { embeddedChunks: 0, chunkCount: 0 };
    const embeddedChunks = Number(semantic.embeddedChunks) || 0;
    const chunkCount = Number(semantic.chunkCount) || 0;
    const isFullyIndexed = chunkCount > 0 && embeddedChunks >= chunkCount;
    const scv = $('scriptsChunkCount'); if (scv) scv.textContent = `${embeddedChunks}/${chunkCount}`;
    
    // Update Index Progress
    const indexPerc = chunkCount > 0 ? Math.round((embeddedChunks / chunkCount) * 100) : 0;
    const ipv = $('scriptsIndexPerc'); if (ipv) ipv.textContent = `${indexPerc}%`;
    const ipf = $('indexProgressFill'); if (ipf) ipf.style.width = `${indexPerc}%`;

    if (!semanticIndexJobId && semanticIndexStatus) {
        if (mapped === 0) {
            semanticIndexStatus.textContent = 'Waiting for scripts';
        } else if (isFullyIndexed && syncDone) {
            semanticIndexStatus.textContent = 'Codebase fully indexed';
        } else {
            semanticIndexStatus.textContent = syncDone
                ? `Ready to index ${mapped} scripts`
                : `Ready to index ${mapped} synced scripts`;
        }
    }
    if (semanticIndexBtn) {
        semanticIndexBtn.disabled = mapped === 0 || !!semanticIndexJobId || (isFullyIndexed && syncDone);
    }
}

/* ── Render overview clients ─────────────────────────────── */
function renderOverviewClients() {
    const el = $('overviewClientsList');
    const count = $('overviewClientCount');
    count.textContent = clients.length;

    if (clients.length === 0) {
        el.innerHTML = '<div class="no-client-empty"><span>No clients connected</span></div>';
        return;
    }
    el.innerHTML = clients.map(c => {
        return `<div class="section-client" data-cid="${c.clientId}">
            <div class="section-client-avatar">${avatarHtml(c.userId, c.username, 32)}</div>
            <div class="section-client-info">
                <div class="section-client-name">${c.username}</div>
                <div class="section-client-meta">${c.placeName} · ${c.clientId.slice(0, 8)}…</div>
            </div>
            <span class="section-client-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    el.querySelectorAll('.section-client').forEach(item => {
        item.addEventListener('click', () => selectClient(item.dataset.cid));
    });
}


/* ── Tools ───────────────────────────────────────────────── */
const TOOL_BOOL_OPTIONS = [['true', 'Yes'], ['false', 'No']];
const TOOL_CATEGORY_ORDER = ['Search', 'Client', 'Instances', 'Observation', 'Remotes', 'Runtime', 'Execution'];
const TOOL_CATEGORY_ICONS = {
    Search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    Client: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    Instances: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
    Observation: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    Remotes: '<path d="M8 12h8"/><path d="M12 8v8"/><circle cx="12" cy="12" r="9"/>',
    Runtime: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16 14 17h-4c0-1-.5-1.7-1.5-2.5z"/>',
    Execution: '<polygon points="6 4 20 12 6 20 6 4"/>',
};

function toolInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function toolFloat(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toolBool(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return value === true || value === 'true';
}

function toolOptionalJson(value, label) {
    if (!value || !String(value).trim()) return undefined;
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`${label || 'JSON'} is invalid: ${error.message}`);
    }
}

function detectRiskyExecutorMethods(source) {
    const text = String(source || '');
    const checks = [
        ['getgc', /\bgetgc\s*\(/i],
        ['getnilinstances', /\bgetnilinstances\s*\(/i],
        ['getconnections', /\bgetconnections\s*\(/i],
        ['getloadedmodules', /\bgetloadedmodules\s*\(/i],
        ['getreg/getregistry', /\b(?:getreg|getregistry)\s*\(/i],
        ['debug.getregistry', /\bdebug\s*\.\s*getregistry\s*\(/i],
        ['hookfunction', /\bhookfunction\s*\(/i],
        ['hookmetamethod', /\bhookmetamethod\s*\(/i],
        ['getconstants', /\b(?:getconstants|debug\s*\.\s*getconstants)\s*\(/i],
        ['getupvalues', /\b(?:getupvalues|debug\s*\.\s*getupvalues?)\s*\(/i],
        ['getprotos', /\b(?:getprotos|debug\s*\.\s*getprotos)\s*\(/i],
        ['getscriptclosure', /\bgetscriptclosure\s*\(/i],
        ['getrawmetatable', /\bgetrawmetatable\s*\(/i],
        ['setreadonly', /\bsetreadonly\s*\(/i],
    ];
    return checks.filter(([, regex]) => regex.test(text)).map(([name]) => name);
}

const toolDefs = {
    'script-grep': {
        name: 'Script Grep', category: 'Search',
        desc: 'Search across all decompiled scripts using regex or literal patterns.',
        fields: [
            { key: 'query', label: 'Search Pattern', type: 'text', placeholder: 'e.g. RemoteEvent or \\bfunction\\b' },
            { key: 'literal', label: 'Literal Match', type: 'select', options: [['false','Regex'],['true','Literal']], default: 'false' },
            { key: 'caseSensitive', label: 'Case Sensitive', type: 'select', options: [['true','Yes'],['false','No']], default: 'true' },
            { key: 'limit', label: 'Max Scripts', type: 'text', placeholder: '50', default: '50' },
        ],
        buildPayload(vals) { return { type: 'script-grep', query: vals.query, literal: vals.literal === 'true', caseSensitive: vals.caseSensitive === 'true', limit: toolInt(vals.limit, 50) }; }
    },
    'semantic-search': {
        name: 'Semantic Search', category: 'Search',
        desc: 'Natural-language search across decompiled script sources using embeddings.',
        fields: [
            { key: 'query', label: 'Natural Language Query', type: 'text', placeholder: 'e.g. inventory management logic' },
            { key: 'limit', label: 'Max Results', type: 'text', placeholder: '10', default: '10' },
        ],
        buildPayload(vals) { return { type: 'semantic-search', query: vals.query, limit: toolInt(vals.limit, 10) }; }
    },
    'get-script-content': {
        name: 'Get Script Content', category: 'Search',
        desc: 'Read a bounded source range from a mapped script path or ScriptProxy.',
        fields: [
            { key: 'scriptPath', label: 'Script Path / ScriptProxy', type: 'text', placeholder: 'game.ReplicatedStorage.Module or <ScriptProxy: ...>' },
            { key: 'startLine', label: 'Start Line', type: 'text', placeholder: '1', default: '1' },
            { key: 'endLine', label: 'End Line (optional)', type: 'text', placeholder: 'Leave blank for bounded continuation' },
            { key: 'maxLines', label: 'Max Lines', type: 'text', placeholder: '80', default: '80' },
        ],
        buildPayload(vals) {
            const p = { type: 'get-script-content', scriptPath: vals.scriptPath, startLine: toolInt(vals.startLine, 1), maxLines: toolInt(vals.maxLines, 80) };
            if (vals.endLine) p.endLine = toolInt(vals.endLine, undefined);
            return p;
        }
    },

    'get-game-info': {
        name: 'Game Info', category: 'Client',
        desc: 'Get PlaceId, GameId, version, creator and basic game metadata.',
        fields: [{ key: 'includeDescription', label: 'Include Description', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' }],
        buildPayload(vals) { return { type: 'get-game-info', includeDescription: toolBool(vals.includeDescription) }; }
    },
    'get-player-state': {
        name: 'Player State', category: 'Client',
        desc: 'Compact LocalPlayer, Character, Humanoid, camera, movement and equipped-tool state.',
        fields: [], buildPayload() { return { type: 'get-player-state' }; }
    },
    'inspect-visible-gui': {
        name: 'Visible GUI', category: 'Client',
        desc: 'List actually visible GUI objects with text, screen rectangles and stable DebugIds.',
        fields: [
            { key: 'textFilter', label: 'Text / Name Filter', type: 'text', placeholder: 'Optional filter' },
            { key: 'limit', label: 'Max Results', type: 'text', default: '50' },
        ],
        buildPayload(vals) { const p = { type: 'inspect-visible-gui', limit: toolInt(vals.limit, 50) }; if (vals.textFilter) p.textFilter = vals.textFilter; return p; }
    },
    'inspect-animations': {
        name: 'Playing Animations', category: 'Client',
        desc: 'Inspect active LocalPlayer animation tracks, priorities, timing, weights and asset IDs.',
        fields: [{ key: 'limit', label: 'Max Tracks', type: 'text', default: '30' }],
        buildPayload(vals) { return { type: 'inspect-animations', limit: toolInt(vals.limit, 30) }; }
    },
    'inspect-sounds': {
        name: 'Sounds', category: 'Client',
        desc: 'Inspect playing or all Sound instances with volume, timing, rolloff and DebugIds.',
        fields: [
            { key: 'playingOnly', label: 'Playing Only', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'limit', label: 'Max Sounds', type: 'text', default: '30' },
        ],
        buildPayload(vals) { return { type: 'inspect-sounds', playingOnly: toolBool(vals.playingOnly, true), limit: toolInt(vals.limit, 30) }; }
    },
    'get-performance-stats': {
        name: 'Performance Stats', category: 'Client',
        desc: 'Sample FPS and return bounded client memory, network and object-count diagnostics.',
        fields: [{ key: 'sampleSeconds', label: 'Sample Seconds', type: 'text', default: '0.5' }],
        buildPayload(vals) { return { type: 'get-performance-stats', sampleSeconds: toolFloat(vals.sampleSeconds, 0.5) }; }
    },
    'get-executor-capabilities': {
        name: 'Executor Capabilities', category: 'Client',
        desc: 'Check which executor APIs exist without invoking heavy enumeration or hook functions.',
        fields: [], buildPayload() { return { type: 'get-executor-capabilities' }; }
    },
    'search-executor-functions': {
        name: 'Executor Function Search', category: 'Client',
        desc: 'Search getgenv/getfenv/_G for callable executor APIs without invoking them.',
        fields: [
            { key: 'query', label: 'Function / Path Filter', type: 'text', placeholder: 'e.g. websocket, crypt, request' },
            { key: 'limit', label: 'Max Results', type: 'text', default: '100' },
            { key: 'maxDepth', label: 'Max Table Depth', type: 'text', default: '6' },
            { key: 'includeAliases', label: 'Include Aliases', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
        ],
        buildPayload(vals) {
            const p = {
                type: 'search-executor-functions',
                limit: toolInt(vals.limit, 100),
                maxDepth: toolInt(vals.maxDepth, 6),
                includeAliases: toolBool(vals.includeAliases, false),
            };
            if (vals.query) p.query = vals.query;
            return p;
        }
    },

    'search-instances': {
        name: 'Search Instances', category: 'Instances',
        desc: 'Query game instances with QueryDescendants selectors and return stable DebugIds.',
        fields: [
            { key: 'selector', label: 'QueryDescendants Selector', type: 'text', placeholder: 'e.g. Part, Model > Humanoid, .Tagged' },
            { key: 'root', label: 'Root', type: 'text', placeholder: 'game', default: 'game' },
            { key: 'limit', label: 'Max Results', type: 'text', placeholder: '50', default: '50' },
        ],
        buildPayload(vals) { return { type: 'search-instances', selector: vals.selector, root: vals.root || 'game', limit: toolInt(vals.limit, 50) }; }
    },
    'inspect-instances': {
        name: 'Inspect Instances', category: 'Instances',
        desc: 'Batch-read properties, attributes, tags and children by path or DebugId.',
        fields: [
            { key: 'paths', label: 'Targets (one per line)', type: 'textarea', placeholder: 'game.Workspace.Baseplate\ndebug:INSTANCE_DEBUG_ID' },
            { key: 'properties', label: 'Properties (comma-separated)', type: 'text', placeholder: 'Anchored, Position, Size' },
            { key: 'maxChildren', label: 'Max Children', type: 'text', default: '20' },
        ],
        buildPayload(vals) {
            const lines = vals.paths.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            const targets = lines.map(value => {
                const match = value.match(/^(?:debug|id):\s*(.+)$/i);
                return match ? { debugId: match[1].trim() } : { path: value };
            });
            const payload = { type: 'inspect-instances', targets, maxChildren: toolInt(vals.maxChildren, 20) };
            if (vals.properties) payload.properties = vals.properties.split(',').map(v => v.trim()).filter(Boolean);
            return payload;
        }
    },
    'get-descendants-tree': {
        name: 'Descendants Tree', category: 'Instances',
        desc: 'Explore an instance hierarchy with bounded depth and optional class filtering.',
        fields: [
            { key: 'root', label: 'Root Instance', type: 'text', placeholder: 'game.Workspace' },
            { key: 'maxDepth', label: 'Max Depth', type: 'text', default: '3' },
            { key: 'maxChildren', label: 'Max Children / Node', type: 'text', default: '20' },
            { key: 'classFilter', label: 'Class Filter', type: 'text', placeholder: 'Optional, e.g. BasePart' },
        ],
        buildPayload(vals) { const p = { type: 'get-descendants-tree', root: vals.root, maxDepth: toolInt(vals.maxDepth, 3), maxChildren: toolInt(vals.maxChildren, 20) }; if (vals.classFilter) p.classFilter = vals.classFilter; return p; }
    },
    'inspect-module': {
        name: 'Inspect Module', category: 'Instances',
        desc: 'Require a specific ModuleScript by path or DebugId and inspect its cached export shape.',
        fields: [
            { key: 'path', label: 'Module Path', type: 'text', placeholder: 'game.ReplicatedStorage.Modules.Controller' },
            { key: 'debugId', label: 'DebugId (alternative)', type: 'text', placeholder: 'Optional' },
            { key: 'includeValues', label: 'Include Export Values', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'maxKeys', label: 'Max Export Keys', type: 'text', default: '50' },
        ],
        buildPayload(vals) { const p = { type: 'inspect-module', includeValues: toolBool(vals.includeValues), maxKeys: toolInt(vals.maxKeys, 50) }; if (vals.path) p.path = vals.path; if (vals.debugId) p.debugId = vals.debugId; return p; }
    },

    'get-console-output': {
        name: 'Console Output', category: 'Observation',
        desc: 'Retrieve bounded client console output, optionally only entries after a cursor.',
        fields: [
            { key: 'limit', label: 'Max Lines', type: 'text', default: '50' },
            { key: 'filter', label: 'Filter', type: 'text', placeholder: 'Optional text filter' },
            { key: 'sinceCursor', label: 'Since Cursor', type: 'text', placeholder: 'Optional console cursor' },
        ],
        buildPayload(vals) { const p = { type: 'get-console-output', limit: toolInt(vals.limit, 50) }; if (vals.filter) p.filter = vals.filter; if (vals.sinceCursor) p.sinceCursor = vals.sinceCursor; return p; }
    },
    'create-console-cursor': {
        name: 'Create Console Cursor', category: 'Observation',
        desc: 'Mark the current console position so a later Console Output call can show only new entries.',
        fields: [], buildPayload() { return { type: 'create-console-cursor' }; }
    },
    'state-observation': {
        name: 'State Snapshot / Diff', category: 'Observation',
        desc: 'Capture and compare bounded player, console, GUI, sound, animation and optional remote state.',
        fields: [
            { key: 'operation', label: 'Operation', type: 'select', options: [['snapshot','Snapshot'],['diff','Diff'],['delete','Delete Snapshot']], default: 'snapshot' },
            { key: 'snapshotId', label: 'Snapshot ID', type: 'text', placeholder: 'Required for Diff/Delete' },
            { key: 'targets', label: 'Targets JSON', type: 'textarea', placeholder: '[{"path":"game.Workspace.Part","properties":["Position"]}]' },
            { key: 'includePlayer', label: 'Player State', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeConsole', label: 'Console', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeGui', label: 'GUI', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'includeSounds', label: 'Sounds', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'includeAnimations', label: 'Animations', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'includeRemotes', label: 'Remote Spy', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
        ],
        riskMethods(vals) { return toolBool(vals.includeRemotes) ? ['Cobalt remote-spy hooks'] : []; },
        buildPayload(vals) {
            const p = { type: 'state-observation', operation: vals.operation, includePlayer: toolBool(vals.includePlayer, true), includeConsole: toolBool(vals.includeConsole, true), includeGui: toolBool(vals.includeGui), includeSounds: toolBool(vals.includeSounds), includeAnimations: toolBool(vals.includeAnimations), includeRemotes: toolBool(vals.includeRemotes) };
            if (vals.snapshotId) p.snapshotId = vals.snapshotId;
            const targets = toolOptionalJson(vals.targets, 'Targets JSON'); if (targets !== undefined) p.targets = targets;
            return p;
        }
    },
    'observe-action': {
        name: 'Observe Action', category: 'Observation',
        desc: 'Begin/end an action observation and return only what changed across useful client state.',
        fields: [
            { key: 'operation', label: 'Operation', type: 'select', options: [['begin','Begin'],['end','End']], default: 'begin' },
            { key: 'snapshotId', label: 'Snapshot ID', type: 'text', placeholder: 'Required for End' },
            { key: 'targets', label: 'Targets JSON', type: 'textarea', placeholder: '[{"debugId":"...","properties":["Value"]}]' },
            { key: 'includePlayer', label: 'Player State', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeConsole', label: 'Console', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeGui', label: 'GUI', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeSounds', label: 'Sounds', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeAnimations', label: 'Animations', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeRemotes', label: 'Remote Spy', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
        ],
        riskMethods(vals) { return toolBool(vals.includeRemotes) ? ['Cobalt remote-spy hooks'] : []; },
        buildPayload(vals) {
            const p = { type: 'observe-action', operation: vals.operation, includePlayer: toolBool(vals.includePlayer, true), includeConsole: toolBool(vals.includeConsole, true), includeGui: toolBool(vals.includeGui, true), includeSounds: toolBool(vals.includeSounds, true), includeAnimations: toolBool(vals.includeAnimations, true), includeRemotes: toolBool(vals.includeRemotes) };
            if (vals.snapshotId) p.snapshotId = vals.snapshotId;
            const targets = toolOptionalJson(vals.targets, 'Targets JSON'); if (targets !== undefined) p.targets = targets;
            return p;
        }
    },

    'remote-spy': {
        name: 'Remote Spy', category: 'Remotes',
        desc: 'Inspect/control Cobalt remote logs. Status is safe; other operations may initialize remote-spy hooks.',
        fields: [
            { key: 'operation', label: 'Operation', type: 'select', options: [['status','Status (safe)'],['list','List'],['mark','Mark Cursor'],['profile','Profile'],['clear','Clear'],['block','Block'],['unblock','Unblock'],['ignore','Ignore'],['unignore','Unignore']], default: 'status' },
            { key: 'direction', label: 'Direction', type: 'select', options: [['Both','Both'],['Outgoing','Outgoing'],['Incoming','Incoming']], default: 'Both' },
            { key: 'nameFilter', label: 'Name Filter', type: 'text', placeholder: 'Optional' },
            { key: 'sinceCursor', label: 'Since Cursor', type: 'text', placeholder: 'Optional remote cursor' },
            { key: 'limit', label: 'Max Remotes', type: 'text', default: '5' },
            { key: 'maxCallsPerRemote', label: 'Calls / Remote', type: 'text', default: '1' },
            { key: 'summaryOnly', label: 'Summary Only', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'remoteName', label: 'Remote Name', type: 'text', placeholder: 'For block/ignore operations' },
            { key: 'remoteDebugId', label: 'Remote DebugId', type: 'text', placeholder: 'Preferred exact target' },
        ],
        riskMethods(vals) { return vals.operation === 'status' ? [] : ['Cobalt remote-spy hooks']; },
        buildPayload(vals) {
            const p = { type: 'remote-spy', operation: vals.operation, direction: vals.direction, limit: toolInt(vals.limit, 5), maxCallsPerRemote: toolInt(vals.maxCallsPerRemote, 1), summaryOnly: toolBool(vals.summaryOnly, true) };
            ['nameFilter','sinceCursor','remoteName','remoteDebugId'].forEach(k => { if (vals[k]) p[k] = vals[k]; });
            return p;
        }
    },

    'search-runtime-objects': {
        name: 'Runtime Search', category: 'Runtime',
        desc: 'RISKY: bounded getgc search returning opaque handles instead of dumping the full GC.',
        fields: [
            { key: 'objectType', label: 'Object Type', type: 'select', options: [['Any','Any'],['function','Function'],['table','Table']], default: 'Any' },
            { key: 'constantContains', label: 'Constant Contains', type: 'text', placeholder: 'Optional' },
            { key: 'sourceContains', label: 'Source Contains', type: 'text', placeholder: 'Optional' },
            { key: 'upvalueName', label: 'Upvalue Name', type: 'text', placeholder: 'Optional' },
            { key: 'key', label: 'Table Key', type: 'text', placeholder: 'Optional' },
            { key: 'limit', label: 'Max Results', type: 'text', default: '20' },
            { key: 'maxScanned', label: 'Max Scanned', type: 'text', default: '5000' },
        ],
        riskMethods: () => ['getgc'],
        buildPayload(vals) { const p = { type: 'search-runtime-objects', objectType: vals.objectType, limit: toolInt(vals.limit, 20), maxScanned: toolInt(vals.maxScanned, 5000) }; ['constantContains','sourceContains','upvalueName','key'].forEach(k => { if (vals[k]) p[k] = vals[k]; }); return p; }
    },
    'inspect-runtime-object': {
        name: 'Runtime Object', category: 'Runtime',
        desc: 'Inspect a runtime handle. Function inspection may use constants, upvalues or proto APIs.',
        fields: [
            { key: 'handle', label: 'Runtime Handle', type: 'text', placeholder: 'runtime:f:1 or runtime:t:1' },
            { key: 'includeConstants', label: 'Constants', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeUpvalues', label: 'Upvalues', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
            { key: 'includeProtos', label: 'Protos', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'maxEntries', label: 'Max Entries', type: 'text', default: '40' },
        ],
        riskMethods(vals) { const out=[]; if (toolBool(vals.includeConstants,true)) out.push('getconstants'); if (toolBool(vals.includeUpvalues,true)) out.push('getupvalues'); if (toolBool(vals.includeProtos)) out.push('getprotos'); return out; },
        buildPayload(vals) { return { type: 'inspect-runtime-object', handle: vals.handle, includeConstants: toolBool(vals.includeConstants,true), includeUpvalues: toolBool(vals.includeUpvalues,true), includeProtos: toolBool(vals.includeProtos), maxEntries: toolInt(vals.maxEntries,40) }; }
    },
    'recover-nil-scripts': {
        name: 'Recover Nil Scripts', category: 'Runtime',
        desc: 'RISKY: on-demand nil-script discovery. Returns original nil instances by DebugId; never clones/reparents them.',
        fields: [],
        riskMethods: () => ['getnilinstances', 'getloadedmodules', 'getgc', 'getreg/getregistry', 'debug.getregistry/getupvalue'],
        buildPayload() { return { type: 'recover-nil-scripts' }; }
    },
    'search-loaded-modules': {
        name: 'Loaded Modules', category: 'Runtime',
        desc: 'RISKY: search getloadedmodules() with optional bounded export-shape inspection.',
        fields: [
            { key: 'filter', label: 'Filter', type: 'text', placeholder: 'Optional module name/path' },
            { key: 'includeExports', label: 'Include Export Shape', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'false' },
            { key: 'limit', label: 'Max Modules', type: 'text', default: '20' },
        ],
        riskMethods: () => ['getloadedmodules'],
        buildPayload(vals) { const p={type:'search-loaded-modules', includeExports:toolBool(vals.includeExports), limit:toolInt(vals.limit,20)}; if(vals.filter)p.filter=vals.filter; return p; }
    },
    'inspect-connections': {
        name: 'Signal Connections', category: 'Runtime',
        desc: 'List getconnections() for a signal or enable/disable a previously returned connection handle.',
        fields: [
            { key: 'operation', label: 'Operation', type: 'select', options: [['list','List Connections'],['set-state','Set Existing Handle State']], default: 'list' },
            { key: 'path', label: 'Instance Path', type: 'text', placeholder: 'game.Players.LocalPlayer...' },
            { key: 'debugId', label: 'Instance DebugId', type: 'text', placeholder: 'Alternative to path' },
            { key: 'signal', label: 'Signal Name', type: 'text', placeholder: 'e.g. Changed, Activated' },
            { key: 'limit', label: 'Max Connections', type: 'text', default: '20' },
            { key: 'handle', label: 'Connection Handle', type: 'text', placeholder: 'For set-state' },
            { key: 'enabled', label: 'Enabled', type: 'select', options: TOOL_BOOL_OPTIONS, default: 'true' },
        ],
        riskMethods(vals) { return vals.operation === 'list' ? ['getconnections'] : []; },
        buildPayload(vals) {
            if (vals.operation === 'set-state') return { type:'inspect-connections', operation:'set-state', handle:vals.handle, enabled:toolBool(vals.enabled,true) };
            const p={type:'inspect-connections', operation:'list', signal:vals.signal, limit:toolInt(vals.limit,20)}; if(vals.path)p.path=vals.path; if(vals.debugId)p.debugId=vals.debugId; return p;
        }
    },

    'get-data-by-code': {
        name: 'Get Data by Code', category: 'Execution',
        desc: 'Execute Luau and retrieve returned values. Risky executor calls require explicit confirmation.',
        fields: [
            { key: 'code', label: 'Luau Code (must return a value)', type: 'textarea', placeholder: 'return game.PlaceId' },
            { key: 'timeout', label: 'Timeout (ms)', type: 'text', default: '15000' },
        ],
        riskMethods(vals) { return detectRiskyExecutorMethods(vals.code); },
        buildPayload(vals) { return { type:'get-data-by-code', code:vals.code, timeout:toolInt(vals.timeout,15000) }; }
    },
    'execute': {
        name: 'Execute Code', category: 'Execution',
        desc: 'Run typed or locally loaded Luau code. Risky executor calls require explicit confirmation.',
        fields: [{ key: 'code', label: 'Luau Code', type: 'textarea', placeholder: 'print("Hello from dashboard!")', fileUpload: true }],
        riskMethods(vals) { return detectRiskyExecutorMethods(vals.code); },
        buildPayload(vals) { return { type:'execute', code:vals.code }; }
    },
};

let activeTool = null;
const MAX_DASHBOARD_CODE_FILE_BYTES = 8 * 1024 * 1024;
const DASHBOARD_CODE_EXTENSIONS = ['.lua', '.luau', '.txt'];

function isSupportedCodeFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return DASHBOARD_CODE_EXTENSIONS.some(extension => name.endsWith(extension));
}

function setupCodeFileInput() {
    const textarea = $('tf_code');
    const fileInput = $('tf_code_file');
    const dropZone = $('tf_code_drop');
    const fileStatus = $('tf_code_file_status');
    if (!textarea || !fileInput || !dropZone || !fileStatus) return;

    const setDragActive = active => dropZone.classList.toggle('drag-active', active);
    const loadFile = async file => {
        if (!file) return;
        if (!isSupportedCodeFile(file)) {
            showToast('Choose a .lua, .luau, or .txt code file.', 'error');
            return;
        }
        if (file.size > MAX_DASHBOARD_CODE_FILE_BYTES) {
            showToast('Code files must be 8 MiB or smaller.', 'error');
            return;
        }

        fileStatus.textContent = `Loading ${file.name}…`;
        try {
            const bytes = await file.arrayBuffer();
            const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
            textarea.value = source;
            textarea.focus();
            textarea.setSelectionRange(0, 0);
            textarea.scrollTop = 0;
            fileStatus.textContent = `${file.name} · ${formatBytes(file.size)} · loaded, not executed`;
            showToast(`${file.name} loaded. Review it, then click Send to execute.`, 'success');
        } catch {
            fileStatus.textContent = 'Could not read this file as UTF-8 text.';
            showToast('The selected code file is not valid UTF-8 text.', 'error');
        } finally {
            fileInput.value = '';
        }
    };

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener('change', () => void loadFile(fileInput.files?.[0]));

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            setDragActive(true);
        });
    });
    ['dragleave', 'dragend'].forEach(eventName => {
        dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            setDragActive(false);
        });
    });
    dropZone.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        setDragActive(false);
        const files = event.dataTransfer?.files;
        if (!files?.length) return;
        if (files.length > 1) showToast('Only the first dropped file will be loaded.', 'error');
        void loadFile(files[0]);
    });
}

function selectTool(toolKey) {
    if (toolKey === 'semantic-search' && semanticSearchEnabled === false) {
        showToast('Semantic search is disabled', 'error');
        return;
    }

    const def = toolDefs[toolKey];
    if (!def) return;

    activeTool = toolKey;

    // Update Sidebar
    document.querySelectorAll('.tools-list-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tool === toolKey);
    });

    // Update Header
    $('toolExecName').textContent = def.name;
    $('toolExecDesc').textContent = def.desc;
    const riskBadge = $('toolRiskBadge');
    if (riskBadge) {
        const riskAware = typeof def.riskMethods === 'function';
        riskBadge.hidden = !riskAware;
        riskBadge.textContent = 'Risk-aware';
        riskBadge.title = riskAware ? 'Potentially detectable executor methods require confirmation before dispatch.' : '';
    }

    // Reset Result
    $('toolOutputBody').textContent = 'Click Send to execute the tool';
    $('toolResponseStatus').textContent = '';
    $('toolResponseTime').textContent = '';

    toolRunBtn.disabled = false;
    toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    // Build Form (Table Rows)
    if (def.fields.length === 0) {
        $('toolParamsBody').innerHTML = '<tr><td colspan="2" style="color:var(--text-tertiary);font-size:13px;padding:20px 32px;">No parameters required. Click Send to execute.</td></tr>';
    } else {
        $('toolParamsBody').innerHTML = def.fields.map(f => {
            let input;
            if (f.type === 'textarea') {
                const textarea = `<textarea id="tf_${f.key}" placeholder="${f.placeholder || ''}">${f.default || ''}</textarea>`;
                input = f.fileUpload ? `<div class="tool-code-input">
                    ${textarea}
                    <input id="tf_${f.key}_file" type="file" accept=".lua,.luau,.txt,text/plain" hidden>
                    <div class="tool-file-drop" id="tf_${f.key}_drop" role="button" tabindex="0" aria-label="Load a Luau code file">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span><strong>Drop a code file here</strong> or click to browse</span>
                        <small id="tf_${f.key}_file_status">.lua, .luau, or .txt · UTF-8 · up to 8 MiB</small>
                    </div>
                </div>` : textarea;
            } else if (f.type === 'select') {
                const opts = f.options.map(([v, l]) => `<option value="${v}"${v === f.default ? ' selected' : ''}>${l}</option>`).join('');
                input = `<select id="tf_${f.key}">${opts}</select>`;
            } else {
                input = `<input type="text" id="tf_${f.key}" placeholder="${f.placeholder || ''}" value="${f.default || ''}">`;
            }
            return `<tr><td>${f.label}</td><td>${input}</td></tr>`;
        }).join('');
    }

    if (toolKey === 'execute') setupCodeFileInput();
}

function renderToolsList(filter = '') {
    const list = $('toolsList');
    if (!list) return;
    const needle = String(filter || '').trim().toLowerCase();
    let visibleCount = 0;
    const chunks = [];

    for (const category of TOOL_CATEGORY_ORDER) {
        const entries = Object.entries(toolDefs).filter(([key, def]) => {
            if (def.category !== category) return false;
            if (key === 'semantic-search' && semanticSearchEnabled === false) return false;
            if (!needle) return true;
            return `${def.name} ${def.desc} ${key} ${category}`.toLowerCase().includes(needle);
        });
        if (entries.length === 0) continue;

        chunks.push(`<div class="tools-category-label">${escapeHtml(category)}</div>`);
        for (const [key, def] of entries) {
            visibleCount += 1;
            const risky = typeof def.riskMethods === 'function';
            const semanticId = key === 'semantic-search' ? ' id="semanticSearchToolItem"' : '';
            const icon = TOOL_CATEGORY_ICONS[category] || TOOL_CATEGORY_ICONS.Client;
            chunks.push(`<div class="tools-list-item${activeTool === key ? ' active' : ''}" data-tool="${escapeHtml(key)}"${semanticId}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
                <span class="tools-list-item-name">${escapeHtml(def.name)}</span>
                ${risky ? '<span class="tools-risk-dot" title="Risk confirmation may be required"></span>' : ''}
            </div>`);
        }
    }

    list.innerHTML = chunks.join('') || '<div class="tools-empty">No tools match this filter.</div>';
    const count = $('toolsCount');
    if (count) count.textContent = `${visibleCount}/${Object.keys(toolDefs).length}`;
}

const toolsListEl = $('toolsList');
if (toolsListEl) {
    toolsListEl.addEventListener('click', event => {
        const item = event.target.closest('.tools-list-item');
        if (item?.dataset.tool) selectTool(item.dataset.tool);
    });
}
const toolsSearchEl = $('toolsSearch');
if (toolsSearchEl) {
    toolsSearchEl.addEventListener('input', () => renderToolsList(toolsSearchEl.value));
}
renderToolsList();

const toolCopyResponseBtn = $('toolCopyResponseBtn');
if (toolCopyResponseBtn) {
    toolCopyResponseBtn.addEventListener('click', () => {
        const text = $('toolOutputBody')?.textContent || '';
        if (text) copyText(text, 'Tool response');
    });
}
const toolClearResponseBtn = $('toolClearResponseBtn');
if (toolClearResponseBtn) {
    toolClearResponseBtn.addEventListener('click', () => {
        $('toolOutputBody').textContent = '';
        $('toolResponseStatus').textContent = '';
        $('toolResponseTime').textContent = '';
    });
}

function formatProgress(job) {
    const total = Number(job.total) || 0;
    const completed = Number(job.completed) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const count = total > 0 ? `\n${completed}/${total} · ${percent}%` : '';
    return `${job.message || 'Running…'}${count}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollToolProgress(jobId, def) {
    const startTime = performance.now();
    $('toolOutputBody').textContent = 'Initializing…';
    $('toolResponseStatus').textContent = 'Pending';
    $('toolResponseStatus').className = 'tool-res-badge';
    $('toolResponseTime').textContent = '';

    while (true) {
        const res = await fetch('/api/tool-progress?id=' + encodeURIComponent(jobId));
        const job = await res.json();
        
        if (!res.ok || (job.error && !job.status)) {
            throw new Error(job.error || 'Progress lookup failed');
        }

        if (job.status === 'done') {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2);
            $('toolResponseStatus').textContent = '200 OK';
            $('toolResponseStatus').classList.add('tool-res-badge--success');
            $('toolResponseTime').textContent = duration + ' ms';
            toolRunBtn.disabled = false;
            toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
            return;
        }

        if (job.status === 'error') {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = 'Error: ' + (job.error || job.message || 'Failed');
            $('toolResponseStatus').textContent = 'Error';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
            $('toolResponseTime').textContent = duration + ' ms';
            toolRunBtn.disabled = false;
            toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
            return;
        }

        const progressText = formatProgress(job);
        $('toolOutputBody').textContent = progressText;
        toolRunBtn.innerHTML = '<span>' + progressText.split('\n')[0] + '</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10" stroke-dasharray="50" stroke-dashoffset="20"/></svg>';
        await sleep(750);
    }
}

async function pollOverviewIndexProgress(jobId) {
    semanticIndexJobId = jobId;
    if (semanticIndexBtn) semanticIndexBtn.disabled = true;

    while (true) {
        const res = await fetch('/api/tool-progress?id=' + encodeURIComponent(jobId));
        const job = await res.json();
        if (!res.ok || job.error && !job.status) {
            throw new Error(job.error || 'Progress lookup failed');
        }

        if (job.status === 'done') {
            semanticIndexStatus.textContent = job.result || 'Index ready';
            semanticIndexJobId = null;
            updateStatus();
            return;
        }

        if (job.status === 'error') {
            semanticIndexStatus.textContent = 'Error: ' + (job.error || job.message || 'Failed');
            semanticIndexJobId = null;
            updateOverview();
            return;
        }

        semanticIndexStatus.textContent = formatProgress(job).replace('\n', ' · ');
        await sleep(750);
    }
}

async function triggerSemanticIndex() {
    if (semanticSearchEnabled === false) {
        if (semanticIndexStatus) semanticIndexStatus.textContent = 'Disabled';
        showToast('Semantic search is disabled', 'error');
        return;
    }
    if (!selectedClientId || semanticIndexJobId) return;
    semanticIndexStatus.textContent = 'Starting...';
    semanticIndexBtn.disabled = true;

    try {
        const res = await fetch('/api/tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'semantic-search',
                clientId: selectedClientId,
                query: 'codebase overview',
                limit: 1,
                indexOnly: true,
            }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.jobId) throw new Error('No progress job returned');
        await pollOverviewIndexProgress(data.jobId);
    } catch (e) {
        semanticIndexStatus.textContent = 'Error: ' + (e.message || e);
        semanticIndexJobId = null;
        updateOverview();
    }
}

if (semanticIndexBtn) {
    semanticIndexBtn.addEventListener('click', () => triggerSemanticIndex());
}

toolRunBtn.addEventListener('click', async () => {
    if (!activeTool || !selectedClientId) return;
    const def = toolDefs[activeTool];
    if (!def) return;

    const vals = {};
    def.fields.forEach(f => {
        const el = document.getElementById('tf_' + f.key);
        if (el) vals[f.key] = el.value;
    });

    let payload;
    try {
        payload = def.buildPayload(vals);
    } catch (error) {
        $('toolOutputBody').textContent = 'Error: ' + (error.message || error);
        $('toolResponseStatus').textContent = 'ERROR';
        $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
        $('toolResponseTime').textContent = '';
        return;
    }

    const riskMethods = typeof def.riskMethods === 'function'
        ? [...new Set((def.riskMethods(vals, payload) || []).filter(Boolean))]
        : [];
    if (riskMethods.length > 0) {
        const confirmed = await showConfirmDialog({
            title: 'Potentially detectable executor methods',
            desc: `This action may invoke: ${riskMethods.join(', ')}. These executor methods or hooks may increase detection risk in some games. Continue?`,
        });
        if (!confirmed) return;
        payload.userConfirmedRisk = true;
    }

    payload.clientId = selectedClientId;
    if (payload.maxOutputChars == null) payload.maxOutputChars = dashboardPreferences.maxOutputChars;

    toolRunBtn.disabled = true;
    toolRunBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="50" stroke-dashoffset="20"/></svg> Running…';


    const startTime = performance.now();
    try {
        const res = await fetch('/api/tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.error) {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = 'Error: ' + data.error;
            $('toolResponseStatus').textContent = 'ERROR';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
            $('toolResponseTime').textContent = duration + ' ms';
        } else if (data.jobId) {
            await pollToolProgress(data.jobId, def);
        } else {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
            $('toolResponseStatus').textContent = '200 OK';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--success';
            $('toolResponseTime').textContent = duration + 'ms';
        }
    } catch (e) {
        const duration = Math.round(performance.now() - startTime);
        $('toolOutputBody').textContent = 'Network error: ' + e.message;
        $('toolResponseStatus').textContent = 'ERROR';
        $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
        $('toolResponseTime').textContent = duration + ' ms';
    }

    toolRunBtn.disabled = false;
    toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
});

/* ── CSS spin animation ──────────────────────────────────── */
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

/* ── Server logs ─────────────────────────────────────────── */
let serverLogsLive = true;
async function fetchServerLogs() {
    try {
        const res = await fetch('/api/server-logs?limit=200');
        const data = await res.json();
        renderServerLogs(data.logs || []);
    } catch(e) {}
}
function renderServerLogs(entries) {
    const body = $('serverLogsTableBody');
    if (!entries.length) { body.innerHTML = '<div class="logs-empty">No server logs yet</div>'; return; }
    
    // Preserve scroll position during live updates
    const savedScroll = body.scrollTop;
    const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30;
    
    body.innerHTML = entries.map(e => {
        const d = new Date(e.timestamp);
        const time = formatTimeFull(d);
        const lvlClass = e.level === 'error' ? 'logs-type-error' : e.level === 'warn' ? 'logs-type-event' : 'logs-type-info';
        const rowClass = e.level === 'error' ? ' logs-row--error' : '';
        return `<div class="logs-row${rowClass}" style="grid-template-columns:160px 80px 1fr">
            <div class="logs-col logs-col--time">${time}</div>
            <div class="logs-col logs-col--type"><span class="${lvlClass}">${e.level}</span></div>
            <div class="logs-col logs-col--message">${escapeHtml(e.message)}</div>
        </div>`;
    }).join('');
    
    // Restore scroll: if user was near bottom, auto-scroll to bottom; otherwise preserve position
    if (wasAtBottom) {
        body.scrollTop = body.scrollHeight;
    } else {
        body.scrollTop = savedScroll;
    }
}
$('serverLogsClearBtn').addEventListener('click', async () => {
    await fetch('/api/server-logs', { method: 'DELETE' });
    renderServerLogs([]);
    showToast('Server logs cleared', 'info');
});
$('serverLogsLiveBtn').addEventListener('click', () => {
    serverLogsLive = !serverLogsLive;
    const btn = $('serverLogsLiveBtn');
    btn.classList.toggle('logs-btn--live', serverLogsLive);
});

/* ── Scripts view ────────────────────────────────────────── */
let scriptsData = [];
let scriptsSearchQuery = '';
let scriptsSearchRequestId = 0;
let scriptsSearchTimer = null;
let scriptsBrowsePath = []; // current folder path segments
let scriptsViewingFile = null; // currently viewing file debugId
let scriptsViewingFileHasEmbeddings = false;
let scriptsViewingFileSourceAvailable = true;
let scriptsScrollPos = 0; // saved scroll position for the file list
let scriptsDisplayInfo = new Map();

const FOLDER_ICON = '<svg class="scripts-ficon scripts-ficon--folder" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>';
const FILE_ICON = '<img class="scripts-ficon" src="luau.svg" width="16" height="16">';

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateScriptsExportButton() {
    if (!scriptsExportBtn) return;
    const canExport = !!selectedClientId && scriptsData.length > 0;
    scriptsExportBtn.disabled = !canExport;
    scriptsExportBtn.title = canExport
        ? 'Export all stored scripts as a zip'
        : 'No stored scripts to export';
}

function resetScriptsState() {
    scriptsData = [];
    scriptsSearchQuery = '';
    scriptsSearchRequestId += 1;
    if (scriptsSearchTimer) {
        clearTimeout(scriptsSearchTimer);
        scriptsSearchTimer = null;
    }
    scriptsBrowsePath = [];
    scriptsViewingFile = null;
    scriptsViewingFileHasEmbeddings = false;
    scriptsViewingFileSourceAvailable = true;
    scriptsScrollPos = 0;
    scriptsDisplayInfo = new Map();

    const search = $('scriptsSearch');
    if (search) search.value = '';
    const count = $('scriptsCount');
    if (count) count.textContent = '0 scripts';
    const breadcrumb = $('scriptsBreadcrumb');
    if (breadcrumb) {
        breadcrumb.innerHTML = '';
        breadcrumb.style.display = 'none';
    }
    const list = $('scriptsFileList');
    if (list) list.innerHTML = '<div class="logs-empty">No scripts indexed yet</div>';
    const fileMode = $('scriptsFileMode');
    const codeMode = $('scriptsCodeMode');
    if (fileMode) fileMode.style.display = '';
    if (codeMode) codeMode.style.display = 'none';
    updateScriptsExportButton();
}

function filenameFromContentDisposition(header) {
    if (!header) return null;
    const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8) {
        try { return decodeURIComponent(utf8[1].replace(/^"|"$/g, '')); } catch {}
    }
    const quoted = header.match(/filename="([^"]+)"/i);
    if (quoted) return quoted[1];
    const bare = header.match(/filename=([^;]+)/i);
    return bare ? bare[1].trim() : null;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'scripts-export.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportScripts() {
    if (!selectedClientId) return;
    if (scriptsData.length === 0) {
        showToast('No stored scripts to export', 'info');
        updateScriptsExportButton();
        return;
    }

    const label = scriptsExportBtn ? scriptsExportBtn.querySelector('span') : null;
    const originalLabel = label ? label.textContent : '';
    if (scriptsExportBtn) scriptsExportBtn.disabled = true;
    if (label) label.textContent = 'Exporting';

    try {
        const res = await fetch(`/api/scripts/export?clientId=${encodeURIComponent(selectedClientId)}`);
        if (!res.ok) {
            let message = 'Failed to export scripts';
            try {
                const data = await res.json();
                if (data.error) message = data.error;
            } catch {}
            showToast(message, 'error');
            return;
        }

        const blob = await res.blob();
        const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition'));
        downloadBlob(blob, filename);
        showToast(`Exported ${scriptsData.length} scripts as zip`, 'success');
    } catch(e) {
        showToast('Failed to export scripts', 'error');
    } finally {
        if (label) label.textContent = originalLabel || 'Export';
        updateScriptsExportButton();
    }
}

if (scriptsExportBtn) scriptsExportBtn.addEventListener('click', exportScripts);

async function fetchScripts() {
    if (!selectedClientId) return;
    try {
        const res = await fetch(`/api/scripts?clientId=${selectedClientId}`);
        const data = await res.json();
        const newScripts = Array.isArray(data) ? data : (data.scripts || []);

        const previousScripts = new Map(scriptsData.map(script => [script.debugId, script]));
        const scriptsChanged = newScripts.length !== scriptsData.length || newScripts.some(script => {
            const previous = previousScripts.get(script.debugId);
            return !previous ||
                previous.path !== script.path ||
                previous.updatedAt !== script.updatedAt ||
                previous.sourceAvailable !== script.sourceAvailable ||
                previous.sourceError !== script.sourceError ||
                previous.lines !== script.lines ||
                previous.bytes !== script.bytes;
        });

        if (scriptsChanged || (newScripts.length > 0 && $('scriptsFileList').querySelector('.logs-empty'))) {
            scriptsData = newScripts;
            if (scriptsSearchQuery) {
                renderScriptsSearchResults();
            } else {
                $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
            }
            if (!scriptsViewingFile && !scriptsSearchQuery) {
                renderScriptsBrowser();
            }
        }
        updateScriptsExportButton();
    } catch(e) {
        updateScriptsExportButton();
    }
}

function scriptPathParts(path) {
    const parts = String(path || '').split('.').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ['script'];
}

function scriptPathKey(parts) {
    return parts.join('\u0000');
}

function ensureLuauFileName(name) {
    return /\.(lua|luau)$/i.test(name) ? name : name + '.luau';
}

function uniqueScriptDisplayName(name, debugId, usedNames) {
    if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
    }

    const extIdx = name.lastIndexOf('.');
    const stem = extIdx === -1 ? name : name.slice(0, extIdx);
    const ext = extIdx === -1 ? '' : name.slice(extIdx);
    const suffix = String(debugId || 'copy').slice(0, 8).replace(/[^a-z0-9._-]+/gi, '-') || 'copy';
    let i = 2;
    let candidate = stem + '-' + suffix + ext;

    while (usedNames.has(candidate)) {
        candidate = stem + '-' + suffix + '-' + i + ext;
        i += 1;
    }

    usedNames.add(candidate);
    return candidate;
}

function buildScriptDisplayInfo(scripts) {
    const sorted = [...scripts].sort((a, b) => a.path.localeCompare(b.path) || a.debugId.localeCompare(b.debugId));
    const usedNamesByFolder = new Map();
    const info = new Map();

    for (const script of sorted) {
        const parts = scriptPathParts(script.path);
        const folderPath = parts.slice(0, -1);
        const baseName = parts[parts.length - 1] || 'script';
        const folderKey = scriptPathKey(folderPath);
        let usedNames = usedNamesByFolder.get(folderKey);

        if (!usedNames) {
            usedNames = new Set();
            usedNamesByFolder.set(folderKey, usedNames);
        }

        const name = uniqueScriptDisplayName(ensureLuauFileName(baseName), script.debugId, usedNames);
        info.set(script.debugId, {
            folderPath,
            name,
            childFolderName: parts[parts.length - 1] || 'script',
            displayPath: [...folderPath, name].join('/')
        });
    }

    return info;
}

function refreshScriptsDisplayInfo() {
    scriptsDisplayInfo = buildScriptDisplayInfo(scriptsData);
    return scriptsDisplayInfo;
}

function getScriptDisplayInfo(script) {
    if (!scriptsDisplayInfo.has(script.debugId)) refreshScriptsDisplayInfo();
    return scriptsDisplayInfo.get(script.debugId) || {
        folderPath: scriptPathParts(script.path).slice(0, -1),
        name: ensureLuauFileName(scriptPathParts(script.path).pop() || 'script'),
        childFolderName: scriptPathParts(script.path).pop() || 'script',
        displayPath: ensureLuauFileName(scriptPathParts(script.path).join('/') || 'script')
    };
}

function textRangesForQuery(text, query) {
    const value = String(text || '');
    const needle = String(query || '').toLowerCase();
    const haystack = value.toLowerCase();
    const ranges = [];
    let from = 0;

    while (needle && ranges.length < 20) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) break;
        ranges.push([index, index + needle.length]);
        from = index + Math.max(needle.length, 1);
    }

    return ranges;
}

function highlightRanges(text, ranges) {
    const value = String(text || '');
    const sorted = [...(ranges || [])]
        .filter(r => Array.isArray(r) && r.length === 2 && r[1] > r[0])
        .sort((a, b) => a[0] - b[0]);
    let html = '';
    let cursor = 0;

    for (const [rawStart, rawEnd] of sorted) {
        const start = Math.max(cursor, Math.min(value.length, rawStart));
        const end = Math.max(start, Math.min(value.length, rawEnd));
        if (start > cursor) html += escapeHtml(value.slice(cursor, start));
        html += '<mark class="scripts-search-mark">' + escapeHtml(value.slice(start, end)) + '</mark>';
        cursor = end;
    }

    if (cursor < value.length) html += escapeHtml(value.slice(cursor));
    return html || escapeHtml(value);
}

function highlightQuery(text, query) {
    return highlightRanges(text, textRangesForQuery(text, query));
}

function scriptMatchesFileQuery(script, query, displayInfo) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    const info = displayInfo.get(script.debugId) || getScriptDisplayInfo(script);
    return script.path.toLowerCase().includes(q) ||
        script.debugId.toLowerCase().includes(q) ||
        (info && info.displayPath.toLowerCase().includes(q));
}

function getLocalFileSearchHits(query, remoteFiles = []) {
    const displayInfo = refreshScriptsDisplayInfo();
    const byDebugId = new Map(scriptsData.map(script => [script.debugId, script]));
    const seen = new Set();
    const hits = [];

    for (const script of scriptsData) {
        if (!scriptMatchesFileQuery(script, query, displayInfo)) continue;
        seen.add(script.debugId);
        hits.push(script);
    }

    for (const remote of remoteFiles) {
        if (!remote || seen.has(remote.debugId)) continue;
        const local = byDebugId.get(remote.debugId);
        if (local) {
            seen.add(local.debugId);
            hits.push(local);
        }
    }

    return hits;
}

function codeMatchCountLabel(count) {
    return count + ' ' + (count === 1 ? 'match' : 'matches');
}

// Build tree from flat script list
function buildScriptTree(scripts) {
    const root = { children: {}, scripts: [] };
    const displayInfo = buildScriptDisplayInfo(scripts);
    scriptsDisplayInfo = displayInfo;

    for (const s of scripts) {
        const info = displayInfo.get(s.debugId);
        if (!info) continue;
        let node = root;

        for (const seg of info.folderPath) {
            if (!node.children[seg]) node.children[seg] = { children: {}, scripts: [] };
            node = node.children[seg];
        }

        node.scripts.push({ ...s, name: info.name, childFolderName: info.childFolderName, displayPath: info.displayPath });
    }
    return root;
}

function getScriptChildNode(node, script) {
    return node.children[script.childFolderName] || null;
}

function getNodeAt(tree, pathSegs) {
    let node = tree;
    for (const seg of pathSegs) {
        if (!node.children[seg]) return null;
        node = node.children[seg];
    }
    return node;
}

function countScriptsRecursive(node) {
    let c = node.scripts.length;
    for (const k of Object.keys(node.children)) c += countScriptsRecursive(node.children[k]);
    return c;
}

function showFileMode() {
    $('scriptsFileMode').style.display = '';
    $('scriptsFileMode').classList.remove('scripts-file-mode--search');
    $('scriptsCodeMode').style.display = 'none';
    scriptsViewingFile = null;
    
    // Restore scroll position after a short delay to ensure DOM is updated
    setTimeout(() => {
        const list = $('scriptsFileList');
        if (list) list.scrollTop = scriptsScrollPos;
    }, 0);
}

function showCodeMode() {
    $('scriptsFileMode').style.display = 'none';
    $('scriptsCodeMode').style.display = '';
    setCodeTab('code');
}

function setCodeTab(tab) {
    const tabs = document.querySelectorAll('.scripts-code-tab');
    if (tab === 'edit' && !scriptsViewingFileSourceAvailable) tab = 'code';
    tabs.forEach(t => t.classList.toggle('scripts-code-tab--active', t.dataset.tab === tab));
    tabs.forEach(t => {
        if (t.dataset.tab === 'edit') {
            t.disabled = !scriptsViewingFileSourceAvailable;
            t.title = scriptsViewingFileSourceAvailable ? '' : 'Source was unavailable from the executor';
        }
    });
    const codeEl = $('scriptsCodeBody');
    const isEdit = tab === 'edit';
    
    codeEl.contentEditable = isEdit ? 'true' : 'false';
    codeEl.classList.toggle('scripts-edit-active', isEdit);
    if (isEdit) {
        codeEl.focus();
        codeEl.addEventListener('input', onCodeEditInput);
    } else {
        codeEl.removeEventListener('input', onCodeEditInput);
    }
    
    // Show/hide save button
    scriptsCodeSaveBtn.style.display = isEdit ? '' : 'none';
}

function renderBreadcrumb(fileName) {
    const bc = $('scriptsBreadcrumb');
    const atRoot = scriptsBrowsePath.length === 0;
    
    if (atRoot && !fileName) {
        bc.style.display = 'none';
        return;
    }
    
    bc.style.display = 'flex';
    let html = '<button class="scripts-bc-seg' + (!fileName && scriptsBrowsePath.length === 0 ? ' scripts-bc-seg--current' : '') + '" data-bc-idx="-1">game</button>';
    scriptsBrowsePath.forEach((seg, i) => {
        const isCurrent = !fileName && i === scriptsBrowsePath.length - 1;
        html += '<span class="scripts-bc-sep">/</span>';
        html += '<button class="scripts-bc-seg' + (isCurrent ? ' scripts-bc-seg--current' : '') + '" data-bc-idx="' + i + '">' + escapeHtml(seg) + '</button>';
    });
    if (fileName) {
        html += '<span class="scripts-bc-sep">/</span>';
        html += '<span class="scripts-bc-seg scripts-bc-seg--current">' + escapeHtml(fileName) + '</span>';
    }
    bc.innerHTML = html;
}

function renderScriptsBrowser() {
    // Ensure file mode is showing (but don't reset scriptsViewingFile or touch scroll)
    $('scriptsFileMode').style.display = '';
    $('scriptsFileMode').classList.remove('scripts-file-mode--search');
    $('scriptsCodeMode').style.display = 'none';
    
    const tree = buildScriptTree(scriptsData);
    renderBreadcrumb();

    const node = getNodeAt(tree, scriptsBrowsePath);
    const list = $('scriptsFileList');
    if (!list) return;

    // Save current scroll before re-rendering
    const currentScroll = list.scrollTop;

    if (!node) {
        list.innerHTML = '<div class="logs-empty">Path not found</div>';
        return;
    }

    const scripts = [...node.scripts].sort((a, b) => a.name.localeCompare(b.name));
    const scriptChildFolders = new Set(
        scripts.filter(script => getScriptChildNode(node, script)).map(script => script.childFolderName)
    );
    const folderNames = Object.keys(node.children)
        .filter(name => !scriptChildFolders.has(name))
        .sort((a, b) => a.localeCompare(b));

    if (folderNames.length === 0 && scripts.length === 0) {
        list.innerHTML = '<div class="logs-empty">No scripts indexed yet</div>';
        return;
    }

    let html = '';

    // ".." go up row
    if (scriptsBrowsePath.length > 0) {
        html += '<div class="scripts-frow scripts-frow--up" data-action="up"><div class="scripts-fname">' + FOLDER_ICON + '<span class="scripts-fname-text">..</span></div><div></div><div></div><div></div></div>';
    }

    // Folders first
    for (const name of folderNames) {
        const count = countScriptsRecursive(node.children[name]);
        html += '<div class="scripts-frow scripts-frow--folder" data-folder="' + escapeHtml(name) + '">';
        html += '<div class="scripts-fname">' + FOLDER_ICON + '<span class="scripts-fname-text">' + escapeHtml(name) + '</span><span class="scripts-fname-count">' + count + '</span></div>';
        html += '<div class="scripts-fmeta"></div>';
        html += '<div class="scripts-fmeta"></div>';
        html += '<div class="scripts-fmeta scripts-factions"></div>';
        html += '</div>';
    }

    // Scripts
    for (const s of scripts) {
        const childNode = getScriptChildNode(node, s);
        const childCount = childNode ? countScriptsRecursive(childNode) : 0;
        const sourceAvailable = s.sourceAvailable !== false;
        html += '<div class="scripts-frow scripts-frow--file' + (childNode ? ' scripts-frow--hybrid' : '') + (sourceAvailable ? '' : ' scripts-frow--unavailable') + '" data-debug-id="' + escapeHtml(s.debugId) + '" data-path="' + escapeHtml(s.path) + '">';
        html += '<div class="scripts-fname">' + FILE_ICON + '<span class="scripts-fname-text">' + escapeHtml(s.name) + '</span>' + (childCount ? '<span class="scripts-fname-count">' + childCount + ' children</span>' : '') + (sourceAvailable ? '' : '<span class="scripts-source-unavailable">source unavailable</span>') + '</div>';
        html += '<div class="scripts-fmeta">' + (sourceAvailable ? s.lines : '—') + '</div>';
        html += '<div class="scripts-fmeta">' + (sourceAvailable ? formatBytes(s.bytes) : '—') + '</div>';
        html += '<div class="scripts-fmeta scripts-factions">';
        if (childNode) {
            html += '<button class="scripts-child-nav" data-child-folder="' + escapeHtml(s.childFolderName) + '" title="Open ' + childCount + ' child scripts" aria-label="Open child scripts"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>';
        }
        html += '<button class="scripts-menu-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button></div>';
        html += '</div>';
    }

    list.innerHTML = html;
    
    // Restore scroll position
    list.scrollTop = currentScroll;
}

function renderSearchFileHits(files, query) {
    if (!files.length) return '';

    return '<div class="scripts-search-section">' +
        '<div class="scripts-search-heading"><span>Files</span><span>' + files.length + '</span></div>' +
        files.map(script => {
            const info = getScriptDisplayInfo(script);
            return '<button class="scripts-search-file" data-debug-id="' + escapeHtml(script.debugId) + '">' +
                '<span class="scripts-search-file-name">' + FILE_ICON + '<span>' + highlightQuery(info.displayPath, query) + '</span></span>' +
                '<span class="scripts-search-file-meta">' + script.lines + ' lines · ' + formatBytes(script.bytes) + '</span>' +
                '</button>';
        }).join('') +
        '</div>';
}

function renderSearchCodeHits(results, query) {
    if (!results.length) return '';

    return '<div class="scripts-search-section">' +
        '<div class="scripts-search-heading"><span>Code</span><span>' + results.length + '</span></div>' +
        results.map(result => {
            const script = scriptsData.find(s => s.debugId === result.debugId) || result;
            const info = script.debugId ? getScriptDisplayInfo(script) : null;
            const displayPath = info ? info.displayPath : ensureLuauFileName(scriptPathParts(result.path).join('/') || 'script');
            const matchCount = Number(result.matchCount) || (Array.isArray(result.matches) ? result.matches.length : 0);
            const snippets = (result.matches || []).map(match => (
                '<button class="scripts-search-hit" data-debug-id="' + escapeHtml(result.debugId) + '" data-line="' + escapeHtml(match.lineNumber) + '">' +
                    '<span class="scripts-search-line">' + escapeHtml(match.lineNumber) + '</span>' +
                    '<code>' + highlightRanges(match.line, match.ranges) + '</code>' +
                '</button>'
            )).join('');

            return '<div class="scripts-search-code-result">' +
                '<button class="scripts-search-code-head" data-debug-id="' + escapeHtml(result.debugId) + '">' +
                    '<span class="scripts-search-file-name">' + FILE_ICON + '<span>' + highlightQuery(displayPath, query) + '</span></span>' +
                    '<span class="scripts-search-file-meta">' + codeMatchCountLabel(matchCount) + '</span>' +
                '</button>' +
                '<div class="scripts-search-snippets">' + snippets + '</div>' +
                '</div>';
        }).join('') +
        '</div>';
}

async function renderScriptsSearchResults() {
    const query = scriptsSearchQuery.trim();
    const requestId = ++scriptsSearchRequestId;
    const list = $('scriptsFileList');

    if (!selectedClientId) return;

    if (!query) {
        $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
        renderScriptsBrowser();
        return;
    }

    $('scriptsFileMode').style.display = '';
    $('scriptsFileMode').classList.add('scripts-file-mode--search');
    $('scriptsCodeMode').style.display = 'none';
    $('scriptsCount').textContent = 'Searching';
    $('scriptsBreadcrumb').style.display = 'flex';
    $('scriptsBreadcrumb').innerHTML = '<span class="scripts-bc-seg scripts-bc-seg--current">Search results</span>';
    list.innerHTML = '<div class="scripts-search-loading">Searching...</div>';

    try {
        const res = await fetch(`/api/scripts/search?clientId=${encodeURIComponent(selectedClientId)}&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (requestId !== scriptsSearchRequestId || query !== scriptsSearchQuery.trim()) return;

        if (!res.ok) {
            list.innerHTML = '<div class="logs-empty">' + escapeHtml(data.error || 'Search failed') + '</div>';
            $('scriptsCount').textContent = '0 results';
            return;
        }

        const fileHits = getLocalFileSearchHits(query, data.files || []);
        const codeHits = Array.isArray(data.code) ? data.code : [];
        const codeMatchCount = Number(data.totalCodeMatches) || codeHits.reduce((sum, result) => sum + (Number(result.matchCount) || 0), 0);
        const total = fileHits.length + codeMatchCount;
        const limited = data.limited ? ' · limited' : '';
        $('scriptsCount').textContent = total === 0
            ? '0 results'
            : fileHits.length + ' files · ' + codeMatchCount + ' code' + limited;

        if (total === 0) {
            list.innerHTML = '<div class="logs-empty">No matching scripts</div>';
            return;
        }

        list.innerHTML =
            renderSearchFileHits(fileHits, query) +
            renderSearchCodeHits(codeHits, query);
    } catch(e) {
        if (requestId !== scriptsSearchRequestId) return;
        $('scriptsCount').textContent = '0 results';
        list.innerHTML = '<div class="logs-empty">Search failed</div>';
    }
}

$('scriptsSearch').addEventListener('input', (e) => {
    scriptsSearchQuery = e.target.value.trim();
    scriptsSearchRequestId += 1;
    if (scriptsSearchTimer) {
        clearTimeout(scriptsSearchTimer);
        scriptsSearchTimer = null;
    }

    if (scriptsSearchQuery) {
        scriptsSearchTimer = setTimeout(() => {
            scriptsSearchTimer = null;
            renderScriptsSearchResults();
        }, 160);
    } else {
        $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
        renderScriptsBrowser();
    }
});

function clearScriptsSearchState() {
    scriptsSearchQuery = '';
    scriptsSearchRequestId += 1;
    if (scriptsSearchTimer) {
        clearTimeout(scriptsSearchTimer);
        scriptsSearchTimer = null;
    }
    $('scriptsSearch').value = '';
    $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
}

function setBrowsePathForScript(debugId) {
    const script = scriptsData.find(s => s.debugId === debugId);
    if (!script) return;
    scriptsBrowsePath = [...getScriptDisplayInfo(script).folderPath];
}

function openScriptFromSearch(debugId, lineNumber = null) {
    setBrowsePathForScript(debugId);
    clearScriptsSearchState();
    openScriptSource(debugId, lineNumber);
}

// Navigation clicks
$('scriptsFileList').addEventListener('click', (e) => {
    const childNav = e.target.closest('.scripts-child-nav');
    if (childNav) {
        e.stopPropagation();
        scriptsBrowsePath.push(childNav.dataset.childFolder);
        renderScriptsBrowser();
        return;
    }

    // Three-dot menu button clicks
    const menuBtn = e.target.closest('.scripts-menu-btn');
    if (menuBtn) {
        e.stopPropagation();
        showFileContextMenu(menuBtn);
        return;
    }

    const searchTarget = e.target.closest('.scripts-search-file, .scripts-search-code-head, .scripts-search-hit');
    if (searchTarget && searchTarget.dataset.debugId) {
        const lineNumber = searchTarget.dataset.line ? Number(searchTarget.dataset.line) : null;
        openScriptFromSearch(searchTarget.dataset.debugId, lineNumber);
        return;
    }

    const row = e.target.closest('.scripts-frow');
    if (!row) return;

    if (row.dataset.action === 'up') {
        scriptsBrowsePath.pop();
        renderScriptsBrowser();
        return;
    }
    if (row.dataset.folder) {
        scriptsBrowsePath.push(row.dataset.folder);
        renderScriptsBrowser();
        return;
    }
    if (row.dataset.debugId) {
        // Find the script to navigate to its parent folder first
        setBrowsePathForScript(row.dataset.debugId);
        if (scriptsSearchQuery) clearScriptsSearchState();
        openScriptSource(row.dataset.debugId);
    }
});

// Breadcrumb clicks
$('scriptsBreadcrumb').addEventListener('click', (e) => {
    const btn = e.target.closest('.scripts-bc-seg');
    if (!btn || btn.classList.contains('scripts-bc-seg--current')) return;
    const idx = parseInt(btn.dataset.bcIdx, 10);
    scriptsBrowsePath = idx < 0 ? [] : scriptsBrowsePath.slice(0, idx + 1);
    scriptsViewingFile = null;
    renderScriptsBrowser();
});

function scrollScriptCodeToLine(lineNumber) {
    const line = Number(lineNumber);
    if (!scriptsCodeView || !Number.isFinite(line) || line < 1) return;

    const gutter = $('scriptsCodeGutter');
    gutter.querySelectorAll('.scripts-code-gutter--target').forEach(el => {
        el.classList.remove('scripts-code-gutter--target');
    });

    const target = gutter.children[line - 1];
    const lineHeight = target ? target.getBoundingClientRect().height || 20 : 20;
    scriptsCodeView.scrollTop = Math.max(0, (line - 1) * lineHeight - scriptsCodeView.clientHeight * 0.35);

    if (target) target.classList.add('scripts-code-gutter--target');
}

// Inline code viewer
async function openScriptSource(debugId, lineNumber = null) {
    if (!selectedClientId) return;
    
    // Save current scroll position before switching to code mode
    const list = $('scriptsFileList');
    if (list) scriptsScrollPos = list.scrollTop;

    try {
        const res = await fetch(`/api/scripts/source?clientId=${selectedClientId}&debugId=${encodeURIComponent(debugId)}`);
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }

        scriptsViewingFile = debugId;
        scriptsViewingFileSourceAvailable = data.sourceAvailable !== false;
        const lines = data.source.split('\n');

        // Track whether this script has embeddings
        const scriptMeta = scriptsData.find(s => s.debugId === debugId);
        scriptsViewingFileHasEmbeddings = scriptMeta ? !!scriptMeta.hasEmbeddings : false;
        const displayInfo = scriptMeta ? getScriptDisplayInfo(scriptMeta) : null;
        const fileName = displayInfo ? displayInfo.name : ensureLuauFileName(scriptPathParts(data.path).pop() || 'script');

        // Update breadcrumb to show file
        renderBreadcrumb(fileName);

        // Update code info bar
        $('scriptsCodeInfo').textContent = scriptsViewingFileSourceAvailable
            ? lines.length + ' lines (' + lines.filter(l => l.trim()).length + ' loc) · ' + formatBytes(data.source.length)
            : 'Source unavailable from executor';

        // Build line number gutter
        let gutterHtml = '';
        for (let i = 1; i <= lines.length; i++) {
            gutterHtml += '<span>' + i + '</span>';
        }
        $('scriptsCodeGutter').innerHTML = gutterHtml;

        // Set code and highlight
        const codeEl = $('scriptsCodeBody');
        codeEl.textContent = scriptsViewingFileSourceAvailable
            ? data.source
            : '-- Source unavailable\n-- ' + (data.sourceError || 'The executor could not read or decompile this script.');
        codeEl.className = 'language-lua';
        
        if (typeof hljs !== 'undefined') {
            delete codeEl.dataset.highlighted;
            hljs.highlightElement(codeEl);
        }

        showCodeMode();
        updateCodeMenuReindex();

        requestAnimationFrame(() => {
            updateCodeOverflowHint();
            if (lineNumber) scrollScriptCodeToLine(lineNumber);
        });
    } catch(e) {
        showToast('Failed to load script source', 'error');
    }
}

/* ── Code viewer tab switching ───────────────────────────── */
document.querySelectorAll('.scripts-code-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        setCodeTab(tab.dataset.tab);
    });
});

/* ── Cursor preservation helpers ───────────────────────────── */
function saveCaret(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.endContainer, range.endOffset);
    const offset = preRange.toString().length;
    return { offset, collapsed: range.collapsed };
}

function restoreCaret(el, saved) {
    if (!saved) { el.focus(); return; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let pos = 0, node;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (pos + len >= saved.offset) {
            const range = document.createRange();
            range.setStart(node, saved.offset - pos);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
        pos += len;
    }
    el.focus();
}

let codeEditDebounce = null;

function onCodeEditInput() {
    const codeEl = $('scriptsCodeBody');
    clearTimeout(codeEditDebounce);

    // Update line count gutter
    syncGutterFromCode();
    
    codeEditDebounce = setTimeout(() => {
        if (typeof hljs === 'undefined') return;
        const saved = saveCaret(codeEl);
        codeEl.className = 'language-lua';
        delete codeEl.dataset.highlighted;
        hljs.highlightElement(codeEl);
        restoreCaret(codeEl, saved);
    }, 300);
}

function syncGutterFromCode() {
    const codeEl = $('scriptsCodeBody');
    const text = codeEl.textContent || '';
    const lines = text.split('\n');
    const oldCount = $('scriptsCodeGutter').childElementCount;
    if (lines.length === oldCount) return;
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        html += '<span>' + i + '</span>';
    }
    $('scriptsCodeGutter').innerHTML = html;
    $('scriptsCodeInfo').textContent = lines.length + ' lines (' + lines.filter(l => l.trim()).length + ' loc) · ' + formatBytes(text.length);
}

/* ── Save button ───────────────────────────────────────────── */
scriptsCodeSaveBtn.addEventListener('click', async () => {
    const codeEl = $('scriptsCodeBody');
    const source = codeEl.textContent || '';
    scriptsCodeSaveBtn.disabled = true;
    scriptsCodeSaveBtn.textContent = 'Saving…';
    try {
        const res = await fetch('/api/scripts/source', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: selectedClientId,
                debugId: scriptsViewingFile,
                source,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Source saved', 'success');
            $('scriptsCodeInfo').textContent =
                data.lines + ' lines (' + source.split('\n').filter(l => l.trim()).length + ' loc) · ' + formatBytes(data.bytes);
            // Update the script in scriptsData so hasEmbeddings stays in sync
            const script = scriptsData.find(s => s.debugId === scriptsViewingFile);
            if (script) {
                script.lines = data.lines;
                script.bytes = data.bytes;
            }
        } else {
            showToast(data.error || 'Failed to save', 'error');
        }
    } catch(e) {
        showToast('Failed to save source', 'error');
    }
    scriptsCodeSaveBtn.disabled = false;
    scriptsCodeSaveBtn.textContent = 'Save';
});

/* ── Code viewer three-dot menu ──────────────────────────── */
function updateCodeMenuReindex() {
    const item = scriptsCodeMenu.querySelector('[data-action="reindex"]');
    if (item) {
        item.style.display = '';
        item.textContent = scriptsViewingFileHasEmbeddings ? 'Re-index' : 'Index';
    }
}

scriptsCodeMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    updateCodeMenuReindex();
    scriptsCodeMenu.classList.toggle('open');
    closeFileMenu();
});

scriptsCodeMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.scripts-menu-item');
    if (!item) return;
    scriptsCodeMenu.classList.remove('open');

    const action = item.dataset.action;
    if (action === 'copy-source') {
        const codeEl = $('scriptsCodeBody');
        const source = codeEl.textContent || '';
        navigator.clipboard.writeText(source).then(() => {
            showToast('Source copied to clipboard', 'success');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    } else if (action === 'reindex') {
        triggerSemanticIndex();
    }
});

/* ── File row context menu ───────────────────────────────── */
let activeFileMenuDebugId = null;

function clampMenuPosition(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function positionFileContextMenu(btn) {
    const gap = 6;
    const viewportPad = 8;
    const rect = btn.getBoundingClientRect();

    scriptsFileMenu.style.visibility = 'hidden';
    scriptsFileMenu.style.left = '0px';
    scriptsFileMenu.style.top = '0px';
    scriptsFileMenu.classList.add('open');

    const menuRect = scriptsFileMenu.getBoundingClientRect();
    const menuWidth = menuRect.width || 160;
    const menuHeight = menuRect.height || 120;
    const maxLeft = window.innerWidth - menuWidth - viewportPad;
    const maxTop = window.innerHeight - menuHeight - viewportPad;
    const left = clampMenuPosition(rect.right - menuWidth, viewportPad, maxLeft);
    let top = rect.bottom + gap;

    if (top + menuHeight > window.innerHeight - viewportPad) {
        top = rect.top - menuHeight - gap;
    }

    scriptsFileMenu.style.left = left + 'px';
    scriptsFileMenu.style.top = clampMenuPosition(top, viewportPad, maxTop) + 'px';
    scriptsFileMenu.style.visibility = '';
}

function showFileContextMenu(btn) {
    const row = btn.closest('.scripts-frow');
    const debugId = row.dataset.debugId;
    activeFileMenuDebugId = debugId;

    // Always show re-index, but change label based on index status
    const script = scriptsData.find(s => s.debugId === debugId);
    const reindexItem = scriptsFileMenu.querySelector('[data-action="reindex"]');
    if (reindexItem) {
        reindexItem.style.display = '';
        reindexItem.textContent = (script && script.hasEmbeddings) ? 'Re-index' : 'Index';
    }

    // Close code menu if open
    scriptsCodeMenu.classList.remove('open');

    positionFileContextMenu(btn);
}

function closeFileMenu() {
    scriptsFileMenu.classList.remove('open');
    activeFileMenuDebugId = null;
}

// File menu item clicks
scriptsFileMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.scripts-menu-item');
    if (!item || !activeFileMenuDebugId) return;
    e.stopPropagation();
    const action = item.dataset.action;
    const debugId = activeFileMenuDebugId;
    closeFileMenu();

    if (action === 'edit') {
        openScriptSource(debugId).then(() => setCodeTab('edit'));
    } else if (action === 'open') {
        openScriptSource(debugId);
    } else if (action === 'reindex') {
        triggerSemanticIndex();
    }
});

// Click outside to close menus
document.addEventListener('click', (e) => {
    if (!scriptsCodeMenuBtn.contains(e.target) && !scriptsCodeMenu.contains(e.target)) {
        scriptsCodeMenu.classList.remove('open');
    }
    if (!scriptsFileMenu.contains(e.target) && !e.target.closest('.scripts-menu-btn')) {
        closeFileMenu();
    }
});
window.addEventListener('resize', closeFileMenu);
window.addEventListener('scroll', closeFileMenu, true);


/* ── Server graph ────────────────────────────────────────── */
let lastGraphKey = '';

function layoutGraphSide(count, side, w, h, makeNode) {
    if (count <= 0) return [];

    const cx = w / 2;
    const cy = h / 2;
    const yPad = 28;
    const availableY = Math.max(120, h - yPad * 2);
    const minRowGap = 44;
    const maxRows = Math.max(1, Math.floor(availableY / minRowGap) + 1);
    const sidePad = Math.max(42, Math.min(64, w * 0.05));
    const hubGap = Math.max(48, Math.min(120, w * 0.12));
    const outerX = side === 'l' ? sidePad : w - sidePad;
    const innerX = side === 'l' ? cx - hubGap : cx + hubGap;
    const availableX = Math.max(1, Math.abs(innerX - outerX));
    const minColGap = 36;
    const maxCols = Math.max(1, Math.floor(availableX / minColGap) + 1);
    const cols = Math.max(1, Math.min(count, maxCols, Math.ceil(count / maxRows)));
    const rows = Math.ceil(count / cols);
    const rowGap = rows > 1 ? availableY / (rows - 1) : 0;
    const colGap = cols > 1 ? Math.min(96, availableX / (cols - 1)) : 0;
    const density = Math.min(rowGap || 999, colGap || 999);
    const radius = density < 28 ? 11 : density < 36 ? 13 : density < 44 ? 16 : 20;
    const fontSize = radius <= 12 ? 8 : radius <= 14 ? 9 : 10;
    const nodes = [];

    for (let col = 0; col < cols; col++) {
        const first = col * rows;
        const rowsInCol = Math.min(rows, count - first);
        const columnHeight = rowsInCol > 1 ? rowGap * (rowsInCol - 1) : 0;
        const x = side === 'l' ? outerX + col * colGap : outerX - col * colGap;

        for (let row = 0; row < rowsInCol; row++) {
            const index = first + row;
            nodes.push({
                ...makeNode(index),
                x,
                y: cy - columnHeight / 2 + row * rowGap,
                r: radius,
                fontSize
            });
        }
    }

    return nodes;
}

function renderServerGraph() {
    const el = $('serverGraph'); if (!el) return;
    const rc = Math.max(currentRelays, 0), cc = clients.length;
    const w = Math.max(320, Math.round(el.clientWidth || 600));
    const h = Math.max(260, Math.round(el.clientHeight || 300));
    const graphKey = w + ':' + h + ':' + rc + ':' + cc + ':' + clients.map(c => [c.clientId, c.userId, c.username].join('/')).join(',');
    $('serverStatClients').textContent = cc;
    $('serverStatRelays').textContent = rc;
    const ss = $('serverStatStatus');
    ss.textContent = currentConnected ? 'Connected' : 'Disconnected';
    ss.className = 'server-stat-value' + (currentConnected ? ' server-stat-value--green' : '');
    if (graphKey === lastGraphKey) return;
    lastGraphKey = graphKey;
    const cx = w/2, cy = h/2;
    const leftNodes = layoutGraphSide(rc, 'l', w, h, (i) => ({ label: 'R' + (i + 1) }));
    const rightNodes = layoutGraphSide(cc, 'r', w, h, (i) => ({
        label: getInitials(clients[i].username || ''),
        userId: clients[i].userId
    }));
    const colors = ['#a855f7','#f97316','#3b82f6','#22c55e','#ec4899'];
    let s = '<svg viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg"><defs>';
    const allN = [...leftNodes.map((n,i)=>({...n,side:'l',i})), ...rightNodes.map((n,i)=>({...n,side:'r',i}))];
    allN.forEach((n,idx) => {
        const c = colors[idx % colors.length];
        s += '<linearGradient id="bg'+idx+'" x1="0" y1="0" x2="1" y2="0">';
        s += '<stop offset="0%" stop-color="'+c+'" stop-opacity="0"/><stop offset="50%" stop-color="'+c+'"/><stop offset="100%" stop-color="'+c+'" stop-opacity="0"/></linearGradient>';
    });
    rightNodes.forEach((n,i) => {
        s += '<clipPath id="ac'+i+'"><circle cx="'+n.x+'" cy="'+n.y+'" r="'+Math.max(8, n.r - 2)+'"/></clipPath>';
    });
    s += '</defs>';
    allN.forEach((n,idx) => {
        const dx = n.side==='l' ? (cx-n.x)*0.4 : (n.x-cx)*0.4;
        const c1x = n.side==='l' ? n.x+dx : cx+dx, c2x = n.side==='l' ? cx-dx : n.x-dx;
        const p = 'M'+n.x+','+n.y+' C'+c1x+','+n.y+' '+c2x+','+cy+' '+cx+','+cy;
        // Static base line
        s += '<path d="'+p+'" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" pathLength="100"/>';
        // Animated beam using SMIL
        const fromOff = n.side==='l' ? '0' : '-100';
        const toOff = n.side==='l' ? '-100' : '0';
        const delay = (idx * 0.4);
        const c = colors[idx % colors.length];
        s += '<path d="'+p+'" fill="none" stroke="'+c+'" stroke-width="2.5" pathLength="100" stroke-dasharray="20 80" stroke-dashoffset="'+fromOff+'" opacity="0.85">';
        s += '<animate attributeName="stroke-dashoffset" from="'+fromOff+'" to="'+toOff+'" dur="2.5s" begin="'+delay+'s" repeatCount="indefinite"/>';
        s += '</path>';
    });
    s += '<circle cx="'+cx+'" cy="'+cy+'" r="28" fill="#111" stroke="var(--border-light)" stroke-width="1.5"/>';
    s += '<g transform="translate('+(cx-10)+','+(cy-10)+')">';
    s += '<path d="M8.4 1.4L0.6 5.4l8.4 4.2 8.4-4.2-8.4-4z" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '<path d="M0.6 10.2l8.4 4.2 8.4-4.2" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '<path d="M0.6 14.8l8.4 4.2 8.4-4.2" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '</g>';
    leftNodes.forEach(n => {
        s += '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="#111" stroke="var(--border)" stroke-width="1"/>';
        s += '<text x="'+n.x+'" y="'+(n.y+Math.max(3, n.fontSize/2.5))+'" text-anchor="middle" fill="var(--text-secondary)" font-size="'+n.fontSize+'" font-family="var(--mono)">'+escapeHtml(n.label)+'</text>';
    });
    rightNodes.forEach((n,i) => {
        s += '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="#111" stroke="var(--border)" stroke-width="1"/>';
        if (n.userId) {
            const avatarSize = Math.max(16, (n.r - 2) * 2);
            s += '<image href="/api/avatar?userId='+encodeURIComponent(String(n.userId))+'" x="'+(n.x-avatarSize/2)+'" y="'+(n.y-avatarSize/2)+'" width="'+avatarSize+'" height="'+avatarSize+'" clip-path="url(#ac'+i+')" preserveAspectRatio="xMidYMid slice"/>';
        } else {
            s += '<text x="'+n.x+'" y="'+(n.y+Math.max(3, n.fontSize/2.5))+'" text-anchor="middle" fill="var(--text-secondary)" font-size="'+n.fontSize+'" font-family="var(--mono)">'+escapeHtml(n.label)+'</text>';
        }
    });
    if (rc===0 && cc===0) {
        s += '<text x="'+cx+'" y="'+(cy+50)+'" text-anchor="middle" fill="var(--text-tertiary)" font-size="13">No peers connected</text>';
    }
    s += '</svg>';
    el.innerHTML = s;
}

window.addEventListener('resize', () => {
    lastGraphKey = '';
    if (dashboardMode === 'home' && currentView === 'server') renderServerGraph();
});

/* ── Settings ────────────────────────────────────────────── */
/* Toast notifications */
const toastIcons = {
    success: '<svg class="toast-icon toast-icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg class="toast-icon toast-icon--error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg class="toast-icon toast-icon--info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};
function showToast(message, type = 'info', duration = 3500) {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = (toastIcons[type]||toastIcons.info) +
        '<span class="toast-msg">' + escapeHtml(message) + '</span>' +
        '<button class="toast-close" onclick="this.parentElement.classList.add(\'toast--removing\');setTimeout(()=>this.parentElement.remove(),200)">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast--removing');
            setTimeout(() => toast.remove(), 200);
        }
    }, duration);
}

async function loadSettings() {
    populateDashboardPreferenceControls();
    await Promise.allSettled([
        loadSemanticSettings(),
        loadDecompilerSettings()
    ]);
}

function updateSemanticSearchVisibility() {
    const enabled = semanticSearchEnabled !== false;
    const semanticToggle = $('settingsSemanticEnabled');
    if (semanticToggle) semanticToggle.checked = enabled;

    document.querySelectorAll('[data-semantic-settings-panel]').forEach(panel => {
        panel.style.display = enabled ? '' : 'none';
    });

    const semanticIndexPanel = $('semanticIndexPanel');
    if (semanticIndexPanel) semanticIndexPanel.style.display = enabled ? '' : 'none';

    renderToolsList($('toolsSearch')?.value || '');

    if (!enabled) {
        if (semanticIndexBtn) semanticIndexBtn.disabled = true;
        if (semanticIndexStatus) semanticIndexStatus.textContent = 'Disabled';
        if (activeTool === 'semantic-search') selectTool('script-grep');
    }

    updateProviderUI();
}

async function loadSemanticSettings() {
    try {
        const res = await fetch('/api/semantic-settings');
        const d = await res.json();
        semanticSearchEnabled = d.enabled !== false;
        settingsProvider = d.provider || 'openai';
        $('settingsOpenaiUrl').value = d.openaiBaseUrl || '';
        $('settingsOpenaiModel').value = d.openaiModel || '';
        $('settingsOpenaiKey').value = d.openaiApiKeySet ? '••••••••' : '';
        $('settingsOllamaUrl').value = d.ollamaBaseUrl || '';
        $('settingsOllamaModel').value = d.ollamaModel || '';
        $('settingsSaveEmbeddings').checked = d.saveEmbeddingsToDisk === true;
        updateSemanticSearchVisibility();
    } catch(e) {}
}

function formatSettingsJson(value) {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return JSON.stringify(obj, null, 2);
}

async function loadDecompilerSettings() {
    try {
        const res = await fetch('/api/decompiler-settings');
        if (!res.ok) throw new Error('Failed to load decompiler settings');
        const data = await res.json();
        decompilerSettings = data;
        normalizeDecompilerState();
        renderDecompilerSettings();
    } catch(e) {
        showToast('Failed to load decompiler settings', 'error');
    }
}

async function refreshDecompilerHealth() {
    if (dashboardMode !== 'home' || currentView !== 'settings') return;
    if (!decompilerSettings || decompilerHealthRefreshInFlight) return;

    decompilerHealthRefreshInFlight = true;
    try {
        const res = await fetch('/api/decompiler-settings', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        decompilerSettings.health = data.health || null;

        document.querySelectorAll('.decompiler-provider-row').forEach(row => {
            const id = row.dataset.providerId;
            const copy = row.querySelector('.decompiler-provider-copy');
            if (!id || !copy) return;

            const nextHtml = decompilerHealthHtml(id);
            const current = row.querySelector('.decompiler-provider-health');
            if (current && nextHtml) {
                current.outerHTML = nextHtml;
            } else if (current) {
                current.remove();
            } else if (nextHtml) {
                copy.insertAdjacentHTML('beforeend', nextHtml);
            }
        });
    } catch(e) {
        // Keep the settings page quiet during transient server reconnects.
    } finally {
        decompilerHealthRefreshInFlight = false;
    }
}

function knownDecompilerIds() {
    const ids = Object.keys(decompilerProviderUi);
    if (decompilerSettings && decompilerSettings.providers) {
        for (const id of Object.keys(decompilerSettings.providers)) {
            if (!ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

function providerUi(id) {
    return decompilerProviderUi[id] || {
        label: id,
        byline: 'custom',
        description: 'Custom decompiler provider.'
    };
}

function ensureDecompilerProvider(id) {
    if (id === 'medal') id = 'shiny';
    if (!decompilerSettings) {
        decompilerSettings = { providerOrder: [], providers: {}, providerInfo: [] };
    }
    if (!decompilerSettings.providers) decompilerSettings.providers = {};
    if (!decompilerSettings.providers[id]) {
        decompilerSettings.providers[id] = {
            enabled: false,
            endpoint: '',
            version: null,
            options: {},
            apiKeySet: false,
            apiKeyMasked: ''
        };
    }
    if (id === 'shiny') {
        const provider = decompilerSettings.providers[id];
        if (!provider.endpoint) provider.endpoint = SHINY_HOSTED_ENDPOINT;
        setShinyMode(provider, shinyMode(provider), true);
    }
    return decompilerSettings.providers[id];
}

function normalizeDecompilerState() {
    if (!decompilerSettings) return;
    if (!Array.isArray(decompilerSettings.providerOrder)) decompilerSettings.providerOrder = [];
    if (!decompilerSettings.providers) decompilerSettings.providers = {};
    decompilerSettings.runtime = normalizeDecompilerRuntime(decompilerSettings.runtime);
    if (decompilerSettings.providers.medal) {
        const medal = decompilerSettings.providers.medal;
        const shiny = ensureDecompilerProvider('shiny');
        const medalMode = {
            ...medal,
            endpoint: medal.endpoint || SHINY_HOSTED_ENDPOINT,
            options: {
                ...(medal.options && typeof medal.options === 'object' && !Array.isArray(medal.options) ? medal.options : {}),
                mode: 'hosted'
            }
        };
        if (medal.enabled === true || shiny.enabled !== true) {
            decompilerSettings.providers.shiny = medalMode;
        }
        delete decompilerSettings.providers.medal;
    }

    const order = [];
    for (const id of decompilerSettings.providerOrder) {
        const normalizedId = id === 'medal' ? 'shiny' : id;
        if (typeof normalizedId === 'string' && !order.includes(normalizedId)) order.push(normalizedId);
    }
    for (const id of knownDecompilerIds()) {
        if (!order.includes(id)) order.push(id);
    }
    decompilerSettings.providerOrder = order;
}

function clampRuntimeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeDecompilerRuntime(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const defaults = cloneDefaultDecompilerRuntime();
    const inputTimeouts = input.providerTimeoutsMs && typeof input.providerTimeoutsMs === 'object' && !Array.isArray(input.providerTimeoutsMs)
        ? input.providerTimeoutsMs
        : {};
    const providerTimeoutsMs = {};
    for (const id of Object.keys(defaults.providerTimeoutsMs)) {
        providerTimeoutsMs[id] = Math.round(clampRuntimeNumber(inputTimeouts[id], defaults.providerTimeoutsMs[id], 500, 60000));
    }
    return {
        adaptiveFallback: typeof input.adaptiveFallback === 'boolean' ? input.adaptiveFallback : defaults.adaptiveFallback,
        loadBalanceSlowProviders: typeof input.loadBalanceSlowProviders === 'boolean' ? input.loadBalanceSlowProviders : defaults.loadBalanceSlowProviders,
        overallTimeoutMs: Math.round(clampRuntimeNumber(input.overallTimeoutMs, defaults.overallTimeoutMs, 3000, 60000)),
        slowAfterMs: Math.round(clampRuntimeNumber(input.slowAfterMs, defaults.slowAfterMs, 500, 60000)),
        cooldownMs: Math.round(clampRuntimeNumber(input.cooldownMs, defaults.cooldownMs, 5000, 600000)),
        slowSuccessLimit: Math.round(clampRuntimeNumber(input.slowSuccessLimit, defaults.slowSuccessLimit, 1, 20)),
        timeoutLimit: Math.round(clampRuntimeNumber(input.timeoutLimit, defaults.timeoutLimit, 1, 20)),
        providerTimeoutsMs
    };
}

function formatRuntimeSliderValue(value, format) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (format === 'seconds') {
        return Number.isInteger(number) ? `${number}s` : `${number.toFixed(1)}s`;
    }
    return String(Math.round(number));
}

function updateRuntimeSliderValue(input) {
    if (!input) return;
    const outputId = input.dataset.runtimeOutput;
    const output = outputId ? $(outputId) : null;
    if (!output) return;
    output.textContent = formatRuntimeSliderValue(input.value, input.dataset.runtimeFormat);
}

function setRuntimeSliderValue(id, value) {
    const input = $(id);
    if (!input) return;
    input.value = String(value);
    updateRuntimeSliderValue(input);
}

function renderDecompilerRuntimeAdvanced() {
    const fields = $('decompilerRuntimeAdvancedFields');
    const toggle = $('decompilerRuntimeAdvancedToggle');
    const chevron = $('decompilerRuntimeAdvancedChevron');
    if (fields) fields.hidden = !decompilerRuntimeAdvancedOpen;
    if (toggle) toggle.setAttribute('aria-expanded', decompilerRuntimeAdvancedOpen ? 'true' : 'false');
    if (chevron) chevron.textContent = decompilerRuntimeAdvancedOpen ? '^' : 'v';
}

function renderDecompilerRuntimeSettings() {
    if (!decompilerSettings) return;
    const runtime = normalizeDecompilerRuntime(decompilerSettings.runtime);
    decompilerSettings.runtime = runtime;
    const adaptive = $('decompilerAdaptiveFallback');
    if (adaptive) adaptive.checked = runtime.adaptiveFallback !== false;
    const loadBalance = $('decompilerLoadBalanceSlowProviders');
    if (loadBalance) loadBalance.checked = runtime.loadBalanceSlowProviders !== false;
    setRuntimeSliderValue('decompilerOverallTimeout', runtime.overallTimeoutMs / 1000);
    setRuntimeSliderValue('decompilerSlowAfter', runtime.slowAfterMs / 1000);
    setRuntimeSliderValue('decompilerCooldown', runtime.cooldownMs / 1000);
    setRuntimeSliderValue('decompilerSlowLimit', runtime.slowSuccessLimit);
    setRuntimeSliderValue('decompilerTimeoutLimit', runtime.timeoutLimit);
    renderDecompilerRuntimeAdvanced();
}

function activeDecompilerOrder() {
    normalizeDecompilerState();
    return decompilerSettings.providerOrder.filter(id => {
        const provider = ensureDecompilerProvider(id);
        return provider.enabled === true;
    });
}

function setActiveDecompilerOrder(activeOrder) {
    const active = activeOrder.filter((id, index) => typeof id === 'string' && activeOrder.indexOf(id) === index);
    const rest = decompilerSettings.providerOrder.filter(id => !active.includes(id));
    decompilerSettings.providerOrder = [...active, ...rest];
}

function arraysEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decompilerRowPositions(list) {
    const positions = new Map();
    list.querySelectorAll('.decompiler-provider-row').forEach(row => {
        positions.set(row.dataset.providerId, row.getBoundingClientRect().top);
    });
    return positions;
}

function animateDecompilerRows(list, previousPositions) {
    if (!previousPositions || previousPositions.size === 0) return;
    list.querySelectorAll('.decompiler-provider-row').forEach(row => {
        const previousTop = previousPositions.get(row.dataset.providerId);
        if (previousTop == null) return;
        const delta = previousTop - row.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) return;
        row.style.transition = 'transform 0s';
        row.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
            row.style.transition = '';
            row.style.transform = '';
        });
    });
}

function decompilerProviderIssue(id, provider) {
    if (!provider || provider.enabled !== true) return null;
    if (id === 'oracle' && !provider.apiKeySet && !provider.apiKey) {
        return 'Authorization required. Add an Oracle API key before this provider can run.';
    }
    if (id !== 'builtin' && typeof provider.endpoint === 'string' && provider.endpoint.trim() === '') {
        return 'Endpoint required. Open provider settings and add a URL.';
    }
    return null;
}

function decompilerProviderIssueSummaries() {
    if (!decompilerSettings) return [];
    return activeDecompilerOrder().map(id => {
        const issue = decompilerProviderIssue(id, ensureDecompilerProvider(id));
        return issue ? `${providerUi(id).label}: ${issue}` : null;
    }).filter(Boolean);
}

function updateDecompilerSaveState() {
    const button = $('saveDecompilerBtn');
    if (!button || !decompilerSettings) return;
    const issues = decompilerProviderIssueSummaries();
    button.disabled = issues.length > 0;
    button.setAttribute('aria-disabled', issues.length > 0 ? 'true' : 'false');
    button.setAttribute('aria-label', issues.length > 0 ? `Fix provider issues before saving. ${issues[0]}` : 'Save decompiler settings');
}

function decompilerProviderByline(id, provider) {
    if (id === 'shiny') {
        return shinyMode(provider) === 'hosted' ? 'hosted' : 'local server';
    }
    return providerUi(id).byline;
}

function decompilerProviderHealth(id) {
    const health = decompilerSettings?.health?.providers;
    return health && typeof health === 'object' ? health[id] : null;
}

function decompilerHealthLabel(status) {
    switch (status) {
        case 'healthy': return 'Healthy';
        case 'slow': return 'Slow';
        case 'cooling_down': return 'Cooling down';
        case 'rate_limited': return 'Rate limited';
        case 'timing_out': return 'Timing out';
        default: return 'Unknown';
    }
}

function decompilerHealthClass(status) {
    if (status === 'healthy') return 'decompiler-health-pill--healthy';
    if (status === 'slow') return 'decompiler-health-pill--slow';
    if (status === 'rate_limited' || status === 'timing_out') return 'decompiler-health-pill--bad';
    if (status === 'cooling_down') return 'decompiler-health-pill--cooldown';
    return '';
}

function relativeDecompilerHealthTime(iso) {
    const time = Date.parse(iso || '');
    if (!Number.isFinite(time)) return '';
    const ageSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (ageSeconds < 5) return 'just now';
    if (ageSeconds < 60) return `${ageSeconds}s ago`;
    return `${Math.round(ageSeconds / 60)}m ago`;
}

function decompilerHealthHtml(id) {
    const health = decompilerProviderHealth(id);
    if (!health || !health.status) return '';
    const status = health.status;
    const detail = [];
    if (Number.isFinite(Number(health.latencyMs))) detail.push(`${Math.round(Number(health.latencyMs))}ms`);
    if (Number.isFinite(Number(health.throughputPerSecond))) {
        detail.push(`${Number(health.throughputPerSecond).toFixed(1)} scripts/s`);
    }
    const age = relativeDecompilerHealthTime(health.updatedAt);
    if (age) detail.push(age);
    const titleBits = [decompilerHealthLabel(status)];
    if (health.lastError) titleBits.push(health.lastError);
    return `
        <div class="decompiler-provider-health">
            <span class="decompiler-health-pill ${decompilerHealthClass(status)}" title="${escapeHtml(titleBits.join(' · '))}">${escapeHtml(decompilerHealthLabel(status))}</span>
            ${detail.length ? `<span class="decompiler-health-detail">${escapeHtml(detail.join(' · '))}</span>` : ''}
        </div>
    `;
}

function decompilerRowHtml(id, index) {
    const provider = ensureDecompilerProvider(id);
    const ui = providerUi(id);
    const issue = decompilerProviderIssue(id, provider);
    const locked = ui.locked === true;
    const dragSvg = '<svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3.5" r="1.15"/><circle cx="10" cy="3.5" r="1.15"/><circle cx="5" cy="7.5" r="1.15"/><circle cx="10" cy="7.5" r="1.15"/><circle cx="5" cy="11.5" r="1.15"/><circle cx="10" cy="11.5" r="1.15"/></svg>';
    const issueSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>';
    const removeSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    const settingsSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.1 4.3l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.7 7.1l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    const meta = id === 'builtin'
        ? ui.description
        : `${decompilerProviderByline(id, provider)}${provider.endpoint ? ' · ' + provider.endpoint : ''}`;

    return `
        <div class="decompiler-provider-row ${locked ? 'decompiler-provider-row--pinned' : ''}" data-provider-id="${escapeHtml(id)}" draggable="false">
            <button class="decompiler-drag-handle" type="button" aria-label="${locked ? 'Provider is locked' : 'Drag to reorder'}" aria-disabled="${locked ? 'true' : 'false'}">${dragSvg}</button>
            <div class="decompiler-rank">#${index + 1}</div>
            <div class="decompiler-provider-copy">
                <div class="decompiler-provider-name">${escapeHtml(ui.label)}</div>
                <div class="decompiler-provider-meta">${escapeHtml(meta)}</div>
                ${decompilerHealthHtml(id)}
            </div>
            <div class="decompiler-provider-actions">
                ${issue ? `<button class="decompiler-row-icon-btn decompiler-row-icon-btn--issue" type="button" data-tooltip="${escapeHtml(issue)}" aria-label="${escapeHtml(issue)}">${issueSvg}</button>` : ''}
                ${!locked ? `<button class="decompiler-row-icon-btn" type="button" data-action="remove-provider" title="Remove provider">${removeSvg}</button>` : ''}
                ${id !== 'builtin' ? `<button class="decompiler-row-icon-btn" type="button" data-action="open-provider-settings" title="Provider settings">${settingsSvg}</button>` : ''}
            </div>
        </div>
    `;
}

function renderDecompilerSettings(options = {}) {
    const list = $('settingsDecompilerList');
    if (!list || !decompilerSettings) return;
    const previousPositions = options.animate ? decompilerRowPositions(list) : null;
    const active = activeDecompilerOrder();
    list.innerHTML = active.length
        ? active.map((id, index) => decompilerRowHtml(id, index)).join('')
        : '<div class="settings-decompiler-empty">No providers enabled</div>';
    if (options.animate) animateDecompilerRows(list, previousPositions);
    renderDecompilerAddMenu();
    renderDecompilerRuntimeSettings();
    updateDecompilerSaveState();
}

function renderDecompilerAddMenu() {
    const menu = $('settingsAddDecompilerMenu');
    if (!menu || !decompilerSettings) return;
    const disabled = knownDecompilerIds().filter(id => !ensureDecompilerProvider(id).enabled);
    if (!disabled.length) {
        menu.innerHTML = '<div class="settings-add-provider-item settings-add-provider-item--empty"><span>All providers are already in the chain</span></div>';
        return;
    }
    menu.innerHTML = disabled.map(id => {
        const ui = providerUi(id);
        return `<button class="settings-add-provider-item" type="button" data-add-provider="${escapeHtml(id)}"><strong>${escapeHtml(ui.label)}</strong><span>${escapeHtml(ui.byline)}</span></button>`;
    }).join('');
}

function collectDecompilerSettings() {
    normalizeDecompilerState();
    const providers = {};
    for (const id of knownDecompilerIds()) {
        const current = ensureDecompilerProvider(id);
        const provider = {
            enabled: current.enabled === true,
            endpoint: current.endpoint || '',
            version: current.version == null ? null : Number(current.version),
            options: current.options && typeof current.options === 'object' && !Array.isArray(current.options) ? current.options : {}
        };
        if (current.apiKey && !String(current.apiKey).startsWith('••')) provider.apiKey = current.apiKey;
        providers[id] = provider;
    }

    return {
        providerOrder: decompilerSettings.providerOrder,
        providers,
        runtime: collectDecompilerRuntimeSettings()
    };
}

function collectDecompilerRuntimeSettings() {
    const current = normalizeDecompilerRuntime(decompilerSettings?.runtime);
    const secondsField = (id, fallback, min, max) => {
        const value = Number($(id)?.value);
        if (!Number.isFinite(value)) return fallback;
        return Math.round(clampRuntimeNumber(value, min / 1000, max / 1000) * 1000);
    };
    return {
        ...current,
        adaptiveFallback: $('decompilerAdaptiveFallback')?.checked !== false,
        loadBalanceSlowProviders: $('decompilerLoadBalanceSlowProviders')?.checked !== false,
        overallTimeoutMs: secondsField('decompilerOverallTimeout', current.overallTimeoutMs, 3000, 60000),
        slowAfterMs: secondsField('decompilerSlowAfter', current.slowAfterMs, 500, 60000),
        cooldownMs: secondsField('decompilerCooldown', current.cooldownMs, 5000, 600000),
        slowSuccessLimit: Math.round(clampRuntimeNumber($('decompilerSlowLimit')?.value, current.slowSuccessLimit, 1, 20)),
        timeoutLimit: Math.round(clampRuntimeNumber($('decompilerTimeoutLimit')?.value, current.timeoutLimit, 1, 20)),
        providerTimeoutsMs: { ...current.providerTimeoutsMs }
    };
}
function updateProviderUI() {
    document.querySelectorAll('#providerToggle .settings-provider-btn').forEach(b => {
        b.classList.toggle('settings-provider-btn--active', b.dataset.provider === settingsProvider);
    });
    const enabled = semanticSearchEnabled !== false;
    $('settingsOpenai').style.display = enabled && settingsProvider === 'openai' ? 'block' : 'none';
    $('settingsOllama').style.display = enabled && settingsProvider === 'ollama' ? 'block' : 'none';
}
document.querySelectorAll('#providerToggle .settings-provider-btn').forEach(b => {
    b.addEventListener('click', () => { settingsProvider = b.dataset.provider; updateProviderUI(); });
});
async function saveSettings(body) {
    try {
        const res = await fetch('/api/semantic-settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        if (res.ok) {
            await loadSettings();
            showToast('Settings saved successfully', 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch(e) {
        showToast('Network error saving settings', 'error');
    }
}

async function saveDecompilerSettings() {
    const issues = decompilerProviderIssueSummaries();
    if (issues.length) {
        renderDecompilerSettings();
        showToast(`Fix provider issues before saving: ${issues[0]}`, 'error');
        return false;
    }

    let body;
    try {
        body = collectDecompilerSettings();
    } catch(e) {
        showToast(e.message || 'Invalid decompiler settings', 'error');
        return false;
    }

    try {
        const res = await fetch('/api/decompiler-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            await loadDecompilerSettings();
            showToast('Decompiler settings saved', 'success');
            return true;
        } else {
            const data = await res.json().catch(() => ({}));
            showToast(data.error || 'Failed to save decompiler settings', 'error');
            return false;
        }
    } catch(e) {
        showToast('Network error saving decompiler settings', 'error');
        return false;
    }
}

function activateDecompilerProvider(id) {
    const provider = ensureDecompilerProvider(id);
    provider.enabled = true;
    const order = decompilerSettings.providerOrder.filter(existing => existing !== id);
    const active = order.filter(existing => ensureDecompilerProvider(existing).enabled);
    const inactive = order.filter(existing => !ensureDecompilerProvider(existing).enabled);
    decompilerSettings.providerOrder = [...active, id, ...inactive];
    renderDecompilerSettings({ animate: true });
}

function removeDecompilerProvider(id) {
    ensureDecompilerProvider(id).enabled = false;
    renderDecompilerSettings({ animate: true });
}

function moveDecompilerProvider(dragId, targetId, insertAfter, options = {}) {
    if (!dragId || !targetId || dragId === targetId) return false;
    const current = activeDecompilerOrder();
    const movable = current.filter(id => id !== dragId);
    const targetIndex = movable.indexOf(targetId);
    if (targetIndex === -1) return false;
    movable.splice(targetIndex + (insertAfter ? 1 : 0), 0, dragId);
    if (arraysEqual(current, movable)) return false;
    setActiveDecompilerOrder(movable);
    renderDecompilerSettings({ animate: options.animate === true });
    return true;
}

function decompilerDomPositions(list) {
    const positions = new Map();
    list.querySelectorAll('.decompiler-provider-row, .decompiler-provider-placeholder').forEach((node) => {
        positions.set(node, node.getBoundingClientRect().top);
    });
    return positions;
}

function animateDecompilerDomShift(list, previousPositions) {
    if (!previousPositions || previousPositions.size === 0) return;
    list.querySelectorAll('.decompiler-provider-row, .decompiler-provider-placeholder').forEach((node) => {
        const previousTop = previousPositions.get(node);
        if (previousTop == null) return;
        const delta = previousTop - node.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) return;
        node.style.transition = 'transform 0s';
        node.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
            node.style.transition = '';
            node.style.transform = '';
        });
    });
}

function orderFromDecompilerDom(list, dragId, placeholder) {
    const order = [];
    for (const child of Array.from(list.children)) {
        if (child === placeholder) {
            order.push(dragId);
        } else if (child.classList.contains('decompiler-provider-row')) {
            order.push(child.dataset.providerId);
        }
    }
    return order.filter(Boolean);
}

function updateDecompilerPreviewRanks() {
    if (!decompilerDragState) return;
    const { list, row: liftedRow, dragId, placeholder } = decompilerDragState;
    const order = orderFromDecompilerDom(list, dragId, placeholder);
    order.forEach((id, index) => {
        const row = id === dragId
            ? liftedRow
            : Array.from(list.querySelectorAll('.decompiler-provider-row')).find((item) => item.dataset.providerId === id);
        const rank = row?.querySelector('.decompiler-rank');
        if (rank) rank.textContent = `#${index + 1}`;
    });
}

function moveDecompilerPlaceholder(clientY) {
    if (!decompilerDragState) return;
    const { list, placeholder } = decompilerDragState;
    const rows = Array.from(list.querySelectorAll('.decompiler-provider-row'));
    let beforeRow = null;

    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
            beforeRow = row;
            break;
        }
    }

    if (beforeRow === placeholder.nextSibling) return;
    const previousPositions = decompilerDomPositions(list);
    if (beforeRow) {
        list.insertBefore(placeholder, beforeRow);
    } else {
        list.appendChild(placeholder);
    }
    animateDecompilerDomShift(list, previousPositions);
    updateDecompilerPreviewRanks();
}

function updateDecompilerPointerDrag(e) {
    if (!decompilerDragState) return;
    const { row, offsetX, offsetY } = decompilerDragState;
    e.preventDefault();
    row.style.left = `${e.clientX - offsetX}px`;
    row.style.top = `${e.clientY - offsetY}px`;
    moveDecompilerPlaceholder(e.clientY);
}

function finishDecompilerPointerDrag(e) {
    if (!decompilerDragState) return;
    if (e) e.preventDefault();

    const state = decompilerDragState;
    const { list, row, placeholder, dragId } = state;
    const finalOrder = orderFromDecompilerDom(list, dragId, placeholder);
    const targetRect = placeholder.getBoundingClientRect();

    document.removeEventListener('pointermove', updateDecompilerPointerDrag);
    document.removeEventListener('pointerup', finishDecompilerPointerDrag);
    document.removeEventListener('pointercancel', cancelDecompilerPointerDrag);
    document.body.classList.remove('decompiler-drag-active');

    row.style.transition = 'top 0.16s cubic-bezier(0.2, 0, 0, 1), left 0.16s cubic-bezier(0.2, 0, 0, 1), width 0.16s cubic-bezier(0.2, 0, 0, 1), transform 0.16s cubic-bezier(0.2, 0, 0, 1)';
    row.style.left = `${targetRect.left}px`;
    row.style.top = `${targetRect.top}px`;
    row.style.width = `${targetRect.width}px`;
    row.style.transform = 'scale(1)';

    window.setTimeout(() => {
        setActiveDecompilerOrder(finalOrder);
        decompilerDragState = null;
        decompilerDragId = null;
        if (row.isConnected && row.parentElement !== list) row.remove();
        placeholder.remove();
        renderDecompilerSettings();
    }, 170);
}

function cancelDecompilerPointerDrag(e) {
    if (!decompilerDragState) return;
    if (e) e.preventDefault();
    const { row, placeholder } = decompilerDragState;
    document.removeEventListener('pointermove', updateDecompilerPointerDrag);
    document.removeEventListener('pointerup', finishDecompilerPointerDrag);
    document.removeEventListener('pointercancel', cancelDecompilerPointerDrag);
    document.body.classList.remove('decompiler-drag-active');
    if (row.isConnected && row.parentElement !== $('settingsDecompilerList')) row.remove();
    placeholder.remove();
    decompilerDragState = null;
    decompilerDragId = null;
    renderDecompilerSettings();
}

function startDecompilerPointerDrag(e) {
    if (e.button != null && e.button !== 0) return;
    const handle = e.target.closest('.decompiler-drag-handle');
    const row = handle?.closest('.decompiler-provider-row');
    const list = $('settingsDecompilerList');
    if (!handle || !row || !list || handle.getAttribute('aria-disabled') === 'true') return;

    e.preventDefault();
    e.stopPropagation();

    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'decompiler-provider-placeholder';
    placeholder.style.height = `${rect.height}px`;
    placeholder.dataset.providerId = row.dataset.providerId;
    list.insertBefore(placeholder, row);

    decompilerDragId = row.dataset.providerId;
    decompilerDragState = {
        dragId: decompilerDragId,
        list,
        row,
        placeholder,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
    };

    row.classList.add('decompiler-provider-row--lifted');
    row.style.position = 'fixed';
    row.style.left = `${rect.left}px`;
    row.style.top = `${rect.top}px`;
    row.style.width = `${rect.width}px`;
    row.style.height = `${rect.height}px`;
    row.style.margin = '0';
    row.style.zIndex = '10050';
    row.style.pointerEvents = 'none';
    row.style.transform = 'scale(1.01)';
    document.body.appendChild(row);
    document.body.classList.add('decompiler-drag-active');
    updateDecompilerPreviewRanks();

    document.addEventListener('pointermove', updateDecompilerPointerDrag);
    document.addEventListener('pointerup', finishDecompilerPointerDrag);
    document.addEventListener('pointercancel', cancelDecompilerPointerDrag);
}

function clearDecompilerDragState() {
    if (decompilerDragState) {
        cancelDecompilerPointerDrag();
        return;
    }
    decompilerDragId = null;
    document.querySelectorAll('.decompiler-provider-row--dragging').forEach(row => {
        row.classList.remove('decompiler-provider-row--dragging');
    });
}

function closeDecompilerProviderModal() {
    $('decompilerProviderModal').classList.remove('open');
    decompilerModalProviderId = null;
}

function closeDecompilerRuntimeModal() {
    $('decompilerRuntimeModal').classList.remove('open');
    renderDecompilerRuntimeSettings();
}

function openDecompilerRuntimeModal() {
    decompilerRuntimeAdvancedOpen = false;
    renderDecompilerRuntimeSettings();
    $('decompilerRuntimeModal').classList.add('open');
}

async function saveDecompilerRuntimeModal() {
    const saved = await saveDecompilerSettings();
    if (saved) closeDecompilerRuntimeModal();
}

function openDecompilerProviderModal(id, options = {}) {
    if (id === 'builtin') return;
    decompilerModalProviderId = id;
    const provider = ensureDecompilerProvider(id);
    const ui = providerUi(id);
    $('decompilerProviderModalTitle').textContent = id === 'oracle' ? 'Oracle settings' : `${ui.label} settings`;
    $('decompilerProviderModalDesc').textContent =
        id === 'oracle' ? 'Configure decompiler options.' : ui.description;
    $('decompilerProviderBody').innerHTML = id === 'oracle'
        ? oracleProviderModalHtml(provider)
        : endpointProviderModalHtml(id, provider);
    $('decompilerProviderModal').classList.add('open');
    if (options.refreshSetup !== false) refreshDecompilerSetupStatus(id);
}

function oracleProviderModalHtml(provider) {
    const maskedKey = provider.apiKey || (provider.apiKeySet ? '••••••••' : '');
    const version = provider.version == null ? '' : String(provider.version);
    const options = formatSettingsJson(provider.options);
    const purchaseUrl = providerUi('oracle').purchaseUrl || '#';
    return `
        <div class="settings-field">
            <label>API key <span class="settings-required">*</span></label>
            <div class="decompiler-input-action-row">
                <input type="password" id="decompilerModalOracleKey" value="${escapeHtml(maskedKey)}" placeholder="Oracle API key">
                <a class="modal-btn modal-btn--cancel decompiler-purchase-btn" href="${escapeHtml(purchaseUrl)}" target="_blank" rel="noreferrer">Purchase</a>
            </div>
        </div>
        <button class="decompiler-advanced-toggle" type="button" data-action="toggle-provider-advanced">Advanced settings <span>${decompilerAdvancedOpen ? '^' : 'v'}</span></button>
        <div class="decompiler-advanced-grid" id="decompilerAdvancedFields" ${decompilerAdvancedOpen ? '' : 'hidden'}>
            <div class="settings-field">
                <label>Version</label>
                <input type="text" id="decompilerModalOracleVersion" value="${escapeHtml(version)}" placeholder="server default">
            </div>
            <div class="settings-field">
                <label>Options JSON</label>
                <textarea id="decompilerModalOracleOptions" rows="6" placeholder="{}">${escapeHtml(options)}</textarea>
            </div>
        </div>
        <div class="decompiler-modal-note">The Oracle key is stored locally and sent to Roblox connectors that use this provider.</div>
        <div class="decompiler-modal-footer">
            <button class="modal-btn modal-btn--cancel" type="button" data-action="close-provider-modal">Cancel</button>
            <button class="modal-btn modal-btn--primary" type="button" data-action="save-provider-modal">Save</button>
        </div>
    `;
}

function decompilerSetupPanelClass(setupState) {
    if (!setupState) return '';
    if (setupState.running || setupState.checking) return 'decompiler-setup-panel--running';
    if (setupState.error || (setupState.installed && setupState.binaryExists === false)) return 'decompiler-setup-panel--error';
    if (setupState.ok || setupState.installed) return 'decompiler-setup-panel--ok';
    return '';
}

function decompilerSetupTitle(id, setupState) {
    const ui = providerUi(id);
    if (setupState?.checking) return `Checking ${ui.label}`;
    if (setupState?.installed) return `${ui.label} installed`;
    return ui.setupLabel;
}

function decompilerSetupDescription(id, setupState) {
    const ui = providerUi(id);
    if (setupState?.checking) return 'Checking the saved local install record.';
    if (setupState?.installed && setupState.binaryExists === false) {
        return 'Install record exists, but the binary is missing. Repair downloads the latest release again.';
    }
    if (setupState?.installed && setupState.serverRunning) {
        return 'Already installed and running. Check for updates downloads the latest release if needed.';
    }
    if (setupState?.installed) {
        return 'Already installed. Check for updates downloads the latest release and starts the local endpoint.';
    }
    return ui.setupDescription || '';
}

function decompilerSetupButtonLabel(setupState) {
    if (setupState?.running) return 'Setting up...';
    if (setupState?.checking) return 'Checking...';
    if (setupState?.installed && setupState.binaryExists === false) return 'Repair install';
    if (setupState?.installed) return 'Check for updates';
    return 'Run setup';
}

function shouldShowDecompilerSetupPanel(id, provider) {
    const ui = providerUi(id);
    if (!ui.setupLabel) return false;
    return id !== 'shiny' || shinyMode(provider) === 'local';
}

function endpointProviderModalHtml(id, provider) {
    const ui = providerUi(id);
    const mode = id === 'shiny' ? shinyMode(provider) : null;
    const storedEndpoint = id === 'shiny' && !provider.endpoint ? shinyEndpointForMode(mode) : provider.endpoint || '';
    const endpoint = endpointDisplayForProvider(id, provider, storedEndpoint);
    const note = id === 'fission'
        ? 'Fission setup runs on the MCP computer; Roblox reaches it through the bridge host.'
        : id === 'shiny'
            ? (mode === 'hosted'
                ? 'Uses the hosted Medal Server endpoint backed by Shiny.'
                : 'Run Shiny on the MCP computer; Roblox reaches it through the bridge host.')
            : ui.description;
    const setupState = decompilerSetupState[id] || null;
    const setupDetails = setupState ? setupState.details : '';
    const setupHtml = shouldShowDecompilerSetupPanel(id, provider) ? `
        <div class="decompiler-setup-panel ${decompilerSetupPanelClass(setupState)}">
            <div>
                <div class="decompiler-setup-title">${escapeHtml(decompilerSetupTitle(id, setupState))}</div>
                <div class="decompiler-setup-desc">${escapeHtml(decompilerSetupDescription(id, setupState))}</div>
            </div>
            <button class="modal-btn modal-btn--cancel decompiler-setup-btn" type="button" data-action="setup-decompiler-provider" ${setupState?.running || setupState?.checking ? 'disabled' : ''}>
                ${escapeHtml(decompilerSetupButtonLabel(setupState))}
            </button>
        </div>
        ${setupState && setupDetails ? `<pre class="decompiler-setup-output">${escapeHtml(setupDetails)}</pre>` : ''}
    ` : '';
    const shinyModeHtml = id === 'shiny' ? `
        <div class="settings-field">
            <label>Mode</label>
            <div class="settings-provider-toggle decompiler-mode-toggle">
                <button class="settings-provider-btn ${mode === 'local' ? 'settings-provider-btn--active' : ''}" type="button" data-action="set-shiny-mode" data-mode="local">Local</button>
                <button class="settings-provider-btn ${mode === 'hosted' ? 'settings-provider-btn--active' : ''}" type="button" data-action="set-shiny-mode" data-mode="hosted">Hosted</button>
            </div>
        </div>
    ` : '';
    return `
        ${shinyModeHtml}
        <div class="settings-field">
            <label>Endpoint</label>
            <input type="text" id="decompilerModalEndpoint" value="${escapeHtml(endpoint)}" placeholder="${escapeHtml(endpointDisplayForProvider(id, provider, id === 'shiny' ? shinyEndpointForMode(mode) : fissionLocalEndpoint()))}">
        </div>
        <div class="decompiler-modal-note">${escapeHtml(note)}</div>
        ${setupHtml}
        <div class="decompiler-modal-footer">
            <button class="modal-btn modal-btn--cancel" type="button" data-action="close-provider-modal">Cancel</button>
            <button class="modal-btn modal-btn--primary" type="button" data-action="save-provider-modal">Save</button>
        </div>
    `;
}

function decompilerSetupResultText(data) {
    const lines = [];
    if (data.endpoint) lines.push(`Endpoint: ${endpointToBridgeHostDisplay(data.endpoint)}`);
    if (data.repoPath) lines.push(`Install path: ${data.repoPath}`);
    if (data.binaryPath) lines.push(`Binary: ${data.binaryPath}`);
    if (data.runCommand) lines.push(`Run command: ${data.runCommand}`);
    if (data.logPath) lines.push(`Log: ${data.logPath}`);
    if (data.alreadyRunning) lines.push('Server was already running.');
    if (data.started) lines.push('Server started successfully.');
    if (data.output) lines.push(data.output);
    if (data.error) lines.push(`Error: ${data.error}`);
    return lines.join('\n\n');
}

function decompilerSetupStatusText(data) {
    if (!data.installed && !data.error) return '';
    const lines = [];
    if (data.installed) lines.push(data.serverRunning ? 'Installed and running.' : 'Installed.');
    if (data.endpoint) lines.push(`Endpoint: ${endpointToBridgeHostDisplay(data.endpoint)}`);
    if (data.repoPath) lines.push(`Install path: ${data.repoPath}`);
    if (data.binaryPath) lines.push(`Binary: ${data.binaryPath}`);
    if (data.logPath) lines.push(`Log: ${data.logPath}`);
    if (data.updatedAt) lines.push(`Last updated: ${data.updatedAt}`);
    if (data.error) lines.push(`Status note: ${data.error}`);
    return lines.join('\n\n');
}

async function refreshDecompilerSetupStatus(id) {
    if (!id) return;
    const provider = ensureDecompilerProvider(id);
    if (!shouldShowDecompilerSetupPanel(id, provider)) return;
    if (decompilerSetupState[id]?.running) return;

    const endpoint = endpointToMcpHostValue($('decompilerModalEndpoint')?.value || provider.endpoint || '');
    decompilerSetupState[id] = {
        ...(decompilerSetupState[id] || {}),
        checking: true,
        running: false,
        error: false,
    };
    if (decompilerModalProviderId === id) openDecompilerProviderModal(id, { refreshSetup: false });

    try {
        const url = new URL('/api/decompiler-settings/setup', window.location.origin);
        url.searchParams.set('provider', id);
        if (endpoint) url.searchParams.set('endpoint', endpoint);
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to check setup status');

        decompilerSetupState[id] = {
            checking: false,
            running: false,
            ok: data.installed === true && data.binaryExists !== false && !data.error,
            error: Boolean(data.error) || (data.installed === true && data.binaryExists === false),
            installed: data.installed === true,
            binaryExists: data.binaryExists === true,
            serverRunning: data.serverRunning === true,
            details: decompilerSetupStatusText(data)
        };
    } catch(e) {
        decompilerSetupState[id] = {
            checking: false,
            running: false,
            ok: false,
            error: true,
            details: e instanceof Error ? e.message : 'Failed to check setup status.'
        };
    }

    if (decompilerModalProviderId === id) openDecompilerProviderModal(id, { refreshSetup: false });
}

async function runDecompilerProviderSetup(id) {
    if (!id || !providerUi(id).setupLabel) return;
    decompilerSetupState[id] = {
        ...(decompilerSetupState[id] || {}),
        checking: false,
        running: true,
        ok: false,
        error: false,
        details: ''
    };
    openDecompilerProviderModal(id, { refreshSetup: false });

    try {
        const provider = ensureDecompilerProvider(id);
        const endpoint = endpointToMcpHostValue($('decompilerModalEndpoint')?.value || provider.endpoint || '');
        const res = await fetch('/api/decompiler-settings/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: id, endpoint })
        });
        const data = await res.json().catch(() => ({}));
        const ok = res.ok && data.ok === true;
        decompilerSetupState[id] = {
            checking: false,
            running: false,
            ok,
            error: !ok,
            installed: ok ? true : decompilerSetupState[id]?.installed === true,
            binaryExists: ok ? true : decompilerSetupState[id]?.binaryExists === true,
            serverRunning: ok ? Boolean(data.started || data.alreadyRunning) : decompilerSetupState[id]?.serverRunning === true,
            details: decompilerSetupResultText(data)
        };

        if (ok && typeof data.endpoint === 'string' && data.endpoint) {
            provider.endpoint = data.endpoint;
            if (id === 'shiny') setShinyMode(provider, 'local', true);
            provider.enabled = true;
            if (!activeDecompilerOrder().includes(id)) activateDecompilerProvider(id);
            await saveDecompilerSettings();
            showToast(`${providerUi(id).label} setup complete`, 'success');
        } else if (ok) {
            showToast(`${providerUi(id).label} setup complete`, 'success');
        } else {
            showToast(data.error || `${providerUi(id).label} setup failed`, 'error');
        }
    } catch(e) {
        decompilerSetupState[id] = {
            checking: false,
            running: false,
            ok: false,
            error: true,
            details: e instanceof Error ? e.message : 'Network error.'
        };
        showToast(`Network error setting up ${providerUi(id).label}`, 'error');
    }

    if (decompilerModalProviderId === id) openDecompilerProviderModal(id, { refreshSetup: false });
}

async function saveDecompilerProviderModal() {
    const id = decompilerModalProviderId;
    if (!id) return;
    const provider = ensureDecompilerProvider(id);

    if (id === 'oracle') {
        const key = ($('decompilerModalOracleKey')?.value || '').trim();
        if (key && !key.startsWith('••')) {
            provider.apiKey = key;
            provider.apiKeySet = true;
        }
        const version = ($('decompilerModalOracleVersion')?.value || '').trim();
        provider.version = version ? Number(version) : null;
        const rawOptions = ($('decompilerModalOracleOptions')?.value || '').trim();
        try {
            provider.options = rawOptions ? JSON.parse(rawOptions) : {};
        } catch(e) {
            showToast('Oracle options must be valid JSON', 'error');
            return;
        }
        if (!provider.options || typeof provider.options !== 'object' || Array.isArray(provider.options)) {
            showToast('Oracle options must be a JSON object', 'error');
            return;
        }
    } else {
        if (id === 'shiny') {
            const mode = $('decompilerProviderBody')?.querySelector('[data-action="set-shiny-mode"].settings-provider-btn--active')?.dataset.mode || shinyMode(provider);
            setShinyMode(provider, mode, true);
        }
        const endpoint = endpointToMcpHostValue($('decompilerModalEndpoint')?.value || '');
        if (!endpoint) {
            showToast('Endpoint is required for this provider', 'error');
            return;
        }
        provider.endpoint = endpoint;
    }

    provider.enabled = true;
    if (!activeDecompilerOrder().includes(id)) activateDecompilerProvider(id);
    const saved = await saveDecompilerSettings();
    if (saved) closeDecompilerProviderModal();
}

$('settingsSemanticEnabled').addEventListener('change', () => {
    semanticSearchEnabled = $('settingsSemanticEnabled').checked;
    updateSemanticSearchVisibility();
});
$('settingsAccentPresets').addEventListener('click', (event) => {
    const button = event.target.closest('[data-accent]');
    if (!button) return;
    $('settingsAccentColor').value = button.dataset.accent;
    dashboardPreferences = normalizeDashboardPreferences({ ...readDashboardPreferenceControls(), accent: button.dataset.accent });
    applyDashboardPreferences();
    populateDashboardPreferenceControls();
});
$('settingsAccentColor').addEventListener('input', () => {
    dashboardPreferences = normalizeDashboardPreferences({ ...readDashboardPreferenceControls(), accent: $('settingsAccentColor').value });
    applyDashboardPreferences();
    populateDashboardPreferenceControls();
});
$('settingsCodeFontSize').addEventListener('input', () => {
    $('settingsCodeFontSizeValue').textContent = `${$('settingsCodeFontSize').value}px`;
});
$('saveDashboardAppearanceBtn').addEventListener('click', () => saveDashboardPreferences('Dashboard appearance saved'));
$('saveMcpPreferencesBtn').addEventListener('click', () => saveDashboardPreferences('MCP defaults saved'));
$('resetDashboardPreferencesBtn').addEventListener('click', () => {
    dashboardPreferences = { ...DEFAULT_DASHBOARD_PREFERENCES };
    localStorage.removeItem(DASHBOARD_PREFERENCES_KEY);
    applyDashboardPreferences();
    populateDashboardPreferenceControls();
    restartDashboardRefreshTimers();
    showToast('Dashboard preferences reset', 'success');
});
$('saveSemanticEnabledBtn').addEventListener('click', () => saveSettings({enabled:$('settingsSemanticEnabled').checked}));
$('saveProviderBtn').addEventListener('click', () => saveSettings({provider:settingsProvider}));
$('saveOpenaiBtn').addEventListener('click', () => {
    const key = $('settingsOpenaiKey').value;
    const body = {
        openaiBaseUrl: $('settingsOpenaiUrl').value,
        openaiModel: $('settingsOpenaiModel').value
    };
    if (key && !key.startsWith('••')) body.openaiApiKey = key;
    saveSettings(body);
});
$('saveOllamaBtn').addEventListener('click', () => saveSettings({ollamaBaseUrl:$('settingsOllamaUrl').value,ollamaModel:$('settingsOllamaModel').value}));
$('saveDecompilerBtn').addEventListener('click', () => saveDecompilerSettings());
$('settingsDecompilerRuntimeBtn').addEventListener('click', openDecompilerRuntimeModal);
$('decompilerRuntimeCloseBtn').addEventListener('click', closeDecompilerRuntimeModal);
$('decompilerRuntimeCancelBtn').addEventListener('click', closeDecompilerRuntimeModal);
$('decompilerRuntimeSaveBtn').addEventListener('click', saveDecompilerRuntimeModal);
$('decompilerRuntimeModal').addEventListener('click', (e) => {
    if (e.target === $('decompilerRuntimeModal')) closeDecompilerRuntimeModal();
});
$('decompilerRuntimeAdvancedToggle').addEventListener('click', () => {
    decompilerRuntimeAdvancedOpen = !decompilerRuntimeAdvancedOpen;
    renderDecompilerRuntimeAdvanced();
});
$('decompilerRuntimeBody').addEventListener('input', (e) => {
    if (e.target?.matches?.('input[type="range"]')) updateRuntimeSliderValue(e.target);
});

$('settingsAddDecompilerBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('settingsAddDecompilerMenu').classList.toggle('open');
    renderDecompilerAddMenu();
});

$('settingsAddDecompilerMenu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-provider]');
    if (!item) return;
    const id = item.dataset.addProvider;
    $('settingsAddDecompilerMenu').classList.remove('open');
    activateDecompilerProvider(id);
    if (id === 'oracle' || id === 'fission' || id === 'shiny') {
        openDecompilerProviderModal(id);
    }
});

$('settingsDecompilerList').addEventListener('click', (e) => {
    const row = e.target.closest('.decompiler-provider-row');
    if (!row) return;
    const id = row.dataset.providerId;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'remove-provider') {
        removeDecompilerProvider(id);
    } else if (action === 'open-provider-settings') {
        openDecompilerProviderModal(id);
    }
});

$('settingsDecompilerList').addEventListener('pointerdown', startDecompilerPointerDrag);

$('decompilerProviderCloseBtn').addEventListener('click', closeDecompilerProviderModal);
$('decompilerProviderModal').addEventListener('click', (e) => {
    if (e.target === $('decompilerProviderModal')) closeDecompilerProviderModal();
});
$('decompilerProviderBody').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close-provider-modal') {
        closeDecompilerProviderModal();
    } else if (action === 'toggle-provider-advanced') {
        decompilerAdvancedOpen = !decompilerAdvancedOpen;
        if (decompilerModalProviderId) openDecompilerProviderModal(decompilerModalProviderId);
    } else if (action === 'setup-decompiler-provider') {
        if (decompilerModalProviderId) runDecompilerProviderSetup(decompilerModalProviderId);
    } else if (action === 'set-shiny-mode') {
        const mode = e.target.dataset.mode === 'local' ? 'local' : 'hosted';
        const provider = ensureDecompilerProvider('shiny');
        setShinyMode(provider, mode);
        openDecompilerProviderModal('shiny');
    } else if (action === 'save-provider-modal') {
        saveDecompilerProviderModal();
    }
});

document.addEventListener('click', (e) => {
    if (!$('settingsAddDecompilerMenu').contains(e.target) && !$('settingsAddDecompilerBtn').contains(e.target)) {
        $('settingsAddDecompilerMenu').classList.remove('open');
    }
});
async function showConfirmDialog({ title, desc }) {
    return new Promise((resolve) => {
        const modal = $('confirmModal');
        const okBtn = $('confirmOkBtn');
        const cancelBtn = $('confirmCancelBtn');
        const titleEl = $('confirmTitle');
        const descEl = $('confirmDesc');

        titleEl.textContent = title || 'Are you absolutely sure?';
        descEl.textContent = desc || 'This action cannot be undone.';
        
        modal.classList.add('open');

        const cleanup = (val) => {
            modal.classList.remove('open');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(val);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

async function deleteEmbeddingCache() {
    const confirmed = await showConfirmDialog({
        title: 'Delete Embedding Cache?',
        desc: 'This will clear all stored script embeddings. They will need to be re-indexed, which may take some time depending on your the game\'s size.'
    });

    if (!confirmed) return;

    try {
        const res = await fetch('/api/semantic-settings', { method:'DELETE' });
        if (res.ok) {
            showToast('Embedding cache cleared', 'success');
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to clear cache', 'error');
        }
    } catch(e) {
        showToast('Network error clearing cache', 'error');
    }
}
$('saveEmbeddingCacheBtn').addEventListener('click', () => saveSettings({saveEmbeddingsToDisk:$('settingsSaveEmbeddings').checked}));
$('deleteEmbeddingCacheBtn').addEventListener('click', () => deleteEmbeddingCache());
$('settingsTestBtn').addEventListener('click', async () => {
    const r = $('settingsTestResult'); r.innerHTML = 'Testing…'; r.className = '';
    try {
        const body = {
            enabled: semanticSearchEnabled,
            provider: settingsProvider,
            openaiBaseUrl: $('settingsOpenaiUrl').value,
            openaiModel: $('settingsOpenaiModel').value,
            ollamaBaseUrl: $('settingsOllamaUrl').value,
            ollamaModel: $('settingsOllamaModel').value
        };
        const key = $('settingsOpenaiKey').value;
        if (key && !key.startsWith('••')) body.openaiApiKey = key;
        const res = await fetch('/api/semantic-settings/test', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const d = await res.json();
        r.textContent = d.ok ? `✓ Success (${d.dimensions||'?'}d, ${d.latencyMs||'?'}ms)` : '✗ ' + (d.error||'Failed');
        r.className = 'settings-test-result ' + (d.ok ? 'settings-test-result--ok' : 'settings-test-result--err');
        showToast(d.ok ? 'Connection test passed' : 'Connection test failed', d.ok ? 'success' : 'error');
    } catch(e) { r.textContent = '✗ Network error'; r.className = 'settings-test-result settings-test-result--err'; showToast('Network error testing connection', 'error'); }
});

/* ── Polling ─────────────────────────────────────────────── */
let currentUpdateStatus = null;

function renderUpdatePrompt(update) {
    currentUpdateStatus = update || null;
    if (!updateBanner) return;

    const dismissedVersion = localStorage.getItem('roblox-mcp-dismissed-update');
    const shouldShow = update?.state === 'update-available' && update.latestVersion !== dismissedVersion;
    updateBanner.hidden = !shouldShow;
    if (!shouldShow) return;

    updateBannerTitle.textContent = `Roblox MCP Bridge ${update.latestVersion} is available`;
    updateBannerMessage.textContent = `You are running ${update.currentVersion}. Updating requires an explicit restart.`;
    updateCopyBtn.textContent = update.gitInstall ? 'Copy update command' : 'Open download page';
}

updateCopyBtn?.addEventListener('click', async () => {
    if (!currentUpdateStatus) return;
    if (!currentUpdateStatus.gitInstall) {
        window.open(currentUpdateStatus.repositoryUrl, '_blank', 'noopener,noreferrer');
        return;
    }

    const command = currentUpdateStatus.updateCommand || 'npm run update';
    try {
        await navigator.clipboard.writeText(command);
        showToast('Update command copied. Run it in the repository folder.', 'success');
    } catch {
        showToast(`Run: ${command}`, 'success');
    }
});

updateDismissBtn?.addEventListener('click', () => {
    if (currentUpdateStatus?.latestVersion) {
        localStorage.setItem('roblox-mcp-dismissed-update', currentUpdateStatus.latestVersion);
    }
    if (updateBanner) updateBanner.hidden = true;
});

async function updateStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        clients = data.clients || [];
        currentRelays = data.relayClients || 0;
        currentConnected = !!data.connected;
        if (data.startedAt) startTime = data.startedAt;
        renderUpdatePrompt(data.update);

        if (!selectedClientId && dashboardPreferences.rememberClient && !rememberedClientSuppressed) {
            const rememberedUsername = localStorage.getItem(DASHBOARD_LAST_CLIENT_KEY);
            const rememberedClient = rememberedUsername ? clients.find(client => client.username === rememberedUsername) : null;
            if (rememberedClient) selectClient(rememberedClient.clientId);
        }

        // Overview tiles
        const cb = $('connBadge'); if(cb) { cb.textContent = data.connected?'Active':'Inactive'; cb.className='status-tile-badge '+(data.connected?'status-tile-badge--green':''); }

        if (selectedClientId && !clients.find(c => c.clientId === selectedClientId)) {
            showToast('Client disconnected', 'error');
            selectedClientId = null;
            resetScriptsState();
            clientSelectorName.textContent = 'Select Client';
            clientSelectorAvatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
            setSidebarMode('home');
            showView('clients');
        }

        if (dashboardMode === 'home' && currentView === 'clients') {
            renderNoClientList(noClientSearch.value.toLowerCase());
        } else if (dashboardMode === 'home' && currentView === 'server') {
            renderServerGraph();
            renderOverviewClients();
        } else if (dashboardMode === 'home' && currentView === 'server-logs' && serverLogsLive) {
            fetchServerLogs();
        } else if (dashboardMode === 'client' && selectedClientId) {
            updateOverview();
        }
    } catch (e) {}
}

function restartDashboardRefreshTimers() {
    if (statusRefreshTimer) clearInterval(statusRefreshTimer);
    if (scriptsRefreshTimer) clearInterval(scriptsRefreshTimer);
    statusRefreshTimer = setInterval(updateStatus, dashboardPreferences.statusRefreshMs);
    scriptsRefreshTimer = setInterval(() => {
        if (dashboardMode === 'client' && currentView === 'scripts' && !scriptsViewingFile) fetchScripts();
    }, dashboardPreferences.scriptsRefreshMs);
}

setInterval(refreshDecompilerHealth, 2000);

applyDashboardPreferences();
restartDashboardRefreshTimers();
loadSemanticSettings();
updateStatus();
setSidebarMode('home');
showView('clients');
