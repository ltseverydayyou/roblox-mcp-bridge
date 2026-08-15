--// Variables \\--
if getgenv().MCP_Loaded == true then
    return
end

getgenv().MCP_Loaded = true

local BridgeURL = getgenv().BridgeURL or getgenv().bridgeurl or ... or "localhost:16384"
getgenv().BridgeURL = BridgeURL
getgenv().bridgeurl = BridgeURL

--// Wait for game to load \\--
if not game:IsLoaded() then
    game.Loaded:Wait()
end

--// Services \\--
local SR = loadstring(game:HttpGet("https://raw.githubusercontent.com/ltseverydayyou/ltseverydayyou.github.io/refs/heads/main/ServiceResolver.luau"))()

local RobloxReplicatedStorage: RobloxReplicatedStorage = SR.cs("RobloxReplicatedStorage", cloneref)
local VirtualInputManager: VirtualInputManager = SR.cs("VirtualInputManager", cloneref)
local MarketplaceService: MarketplaceService = SR.cs("MarketplaceService", cloneref)
local CoreGui: CoreGui = SR.cs("CoreGui", cloneref)
local CorePackages: CorePackages = SR.cs("CorePackages", cloneref)
local ScriptContext: ScriptContext = SR.cs("ScriptContext", cloneref)
local HttpService: HttpService = SR.cs("HttpService", cloneref)
local LogService: LogService = SR.cs("LogService", cloneref)
local Players: Players = SR.cs("Players", cloneref)
local CollectionService: CollectionService = SR.cs("CollectionService", cloneref)
local UserInputService: UserInputService = SR.cs("UserInputService", cloneref)

--// Libraries \\--

local base64_encode
do
    -- Lua 5.1+ base64 v3.0 (c) 2009 by Alex Kloss <alexthkloss@web.de>
    -- licensed under the terms of the LGPL2
    
    -- character table string
    local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    
    -- encoding
    base64_encode = base64encode or function(data)
        return ((data:gsub('.', function(x) 
            local r,b='',x:byte()
            for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
            return r;
        end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
            if (#x < 6) then return '' end
            local c=0
            for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
            return b:sub(c+1,c+1)
        end)..({ '', '==', '=' })[#data%3+1])
    end
end

--// Functions \\--
local getscriptbytecode = getscriptbytecode or function(_) error("Unable to get script bytecode.") end
local GetScriptHash = type(getscripthash) == "function" and getscripthash or nil
local BuiltInDecompile = type(decompile) == "function" and decompile or nil

local LuaEncode = loadstring(game:HttpGet("https://raw.githubusercontent.com/chadhyatt/LuaEncode/refs/heads/master/src/LuaEncode.lua"))()

--// Bounded serialization: cap depth / entries / string length and render
--// Instances as their path so structured tool responses can't flood the
--// model context with raw dumps before the server-side char limit applies. \\--
local SANITIZE_MAX_DEPTH = 8
local SANITIZE_MAX_ENTRIES = 60
local SANITIZE_MAX_STRING = 500

local function SanitizeForOutput(value, depth, seen)
    depth = depth or 0
    local valueType = typeof(value)

    if valueType == "Instance" then
        local ok, full = pcall(function() return value:GetFullName() end)
        return ok and full or tostring(value)
    elseif valueType == "string" then
        if #value > SANITIZE_MAX_STRING then
            return string.sub(value, 1, SANITIZE_MAX_STRING)
                .. "…(+" .. (#value - SANITIZE_MAX_STRING) .. " chars omitted)"
        end
        return value
    elseif valueType == "number" or valueType == "boolean" or valueType == "nil" then
        return value
    elseif valueType ~= "table" then
        -- functions, userdata, threads, Vector3, CFrame, etc.
        return tostring(value)
    end

    if depth >= SANITIZE_MAX_DEPTH then
        return "<table: max depth reached>"
    end

    seen = seen or {}
    if seen[value] then
        return "<cyclic table>"
    end
    seen[value] = true

    local result = {}
    local count = 0
    local omitted = 0
    for k, v in pairs(value) do
        if count >= SANITIZE_MAX_ENTRIES then
            omitted += 1
            continue
        end
        count += 1
        local key = k
        if typeof(k) ~= "string" and typeof(k) ~= "number" then
            key = tostring(k)
        end
        result[key] = SanitizeForOutput(v, depth + 1, seen)
    end
    if omitted > 0 then
        result["__omitted"] = omitted .. " more entries omitted"
    end

    seen[value] = nil
    return result
end

--// Strip the decompiler banner line (e.g. "-- Decompiled with lua.expert")
--// so it doesn't repeat as noise across every script read/grep/search. \\--
local function StripDecompilerBanner(source)
    if typeof(source) ~= "string" then return source end
    return (string.gsub(source, "^%s*%-%-[^\n]*[Dd]ecompiled[^\n]*\n", "", 1))
end

local getnilinstances = getnilinstances or function() return {} end

--// Compatibility Check \\--
local WebSocketAvailable = (
    typeof(WebSocket) ~= "nil" and
    typeof(WebSocket.connect) == "function"
) and (getgenv().DisableWebSocket ~= true)

--// Registration Info \\--
local function GenerateSessionGuid()
    local success, guid = pcall(function()
        return HttpService:GenerateGUID(false)
    end)
    if success and type(guid) == "string" and guid ~= "" then
        return guid
    end
    return tostring(os.clock()) .. "-" .. tostring(math.random(1, 1000000000))
end

local function GetClientIdentityKey()
    local player = Players.LocalPlayer
    return table.concat({
        tostring(game.PlaceId or 0),
        tostring(game.JobId or ""),
        tostring(player and player.UserId or 0),
    }, ":")
end

local function GetStableClientSessionId()
    local identityKey = GetClientIdentityKey()
    if type(getgenv().MCP_ClientSessionId) ~= "string" or getgenv().MCP_ClientIdentityKey ~= identityKey then
        getgenv().MCP_ClientSessionId = GenerateSessionGuid()
        getgenv().MCP_ClientIdentityKey = identityKey
    end
    return getgenv().MCP_ClientSessionId
end

local function GetExecutorInfo()
    local executorName = "Unknown"
    local executorVersion = "Unknown"

    if typeof(identifyexecutor) == "function" then
        pcall(function()
            local name, versionValue = identifyexecutor()
            if type(name) == "string" and name ~= "" then
                executorName = name
            end
            if versionValue ~= nil then
                local text = tostring(versionValue)
                if text ~= "" then
                    executorVersion = text
                end
            end
        end)
    elseif typeof(getexecutorname) == "function" then
        pcall(function()
            local name = getexecutorname()
            if type(name) == "string" and name ~= "" then
                executorName = name
            end
        end)
    end

    if executorVersion == "Unknown" and typeof(getexecutorversion) == "function" then
        pcall(function()
            local versionValue = getexecutorversion()
            if versionValue ~= nil then
                local text = tostring(versionValue)
                if text ~= "" then
                    executorVersion = text
                end
            end
        end)
    end

    return executorName, executorVersion
end

local function GetRobloxVersion()
    local robloxVersion = "Unknown"
    if typeof(version) == "function" then
        pcall(function()
            local value = version()
            if type(value) == "string" and value ~= "" then
                robloxVersion = value
            end
        end)
    end
    return robloxVersion
end

local function GetPlatformName()
    local platform = "Unknown"
    pcall(function()
        local value = UserInputService:GetPlatform()
        local text = tostring(value)
        platform = string.gsub(text, "^Enum%.Platform%.", "")
    end)
    return platform
end

local function GetRegistrationInfo()
    local player = Players.LocalPlayer
    local placeName = "Unknown"
    pcall(function()
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        placeName = productInfo.Name
    end)

    local executorName, executorVersion = GetExecutorInfo()

    return {
        type = "register",
        username = player and player.Name or "Unknown",
        userId = player and player.UserId or 0,
        displayName = player and player.DisplayName or "Unknown",
        placeId = game.PlaceId,
        gameId = game.GameId,
        jobId = game.JobId,
        placeName = placeName,
        executorName = executorName,
        executorVersion = executorVersion,
        robloxVersion = GetRobloxVersion(),
        platform = GetPlatformName(),
        sessionId = GetStableClientSessionId(),
    }
end

--// Base Bridge Class \\--
local BaseBridge = {}; do
    BaseBridge.__index = BaseBridge
    
    function BaseBridge:BindToType(type, callback)
        self.Callbacks[type] = callback
    end

    function BaseBridge:BindToTypeRaw(type, callback)
        self.Callbacks[type] = callback
        self.RawCallbacks = self.RawCallbacks or {}
        self.RawCallbacks[type] = true
    end

    function BaseBridge:CreateAlias(type, aliases)
        for _, alias in aliases do
            self.Callbacks[alias] = self.Callbacks[type]
            if self.RawCallbacks and self.RawCallbacks[type] then
                self.RawCallbacks[alias] = true
            end
        end
    end

    function BaseBridge:HandleMessage(data)
        if self.Callbacks[data.type] then
            local success, result = pcall(function()
                return self.Callbacks[data.type](data)
            end)

            if success and result == nil then
                return nil
            end

            if not success then
                return self:FormatResponse(result, data.id, true)
            end

            if self.RawCallbacks and self.RawCallbacks[data.type] then
                return {
                    output = tostring(result),
                    success = true,
                    id = data.id
                }
            end

            return self:FormatResponse(result, data.id, false)
        end
        return nil
    end
    
    function BaseBridge:FormatResponse(message, id, isError)
        if isError then
            return {
                error = tostring(message),
                success = false,
                id = id
            }
        end
        
        local output = SanitizeForOutput(message)
        if typeof(output) ~= "table" then
            output = { output }
        end
    
        return {
            output = LuaEncode(output, {
                Prettify = false
            }),
            success = true,
            id = id
        }
    end
    
    function BaseBridge:IsAlive()
        local success, result = pcall(function()
            local response
            local thread = task.spawn(function()
                local success, data = pcall(request, {
                    Url = "http://" .. BridgeURL,
                    Method = "GET"
                })

                if success then
                    response = data
                end
            end)

            local start = os.clock()
            repeat task.wait(0.05) until response ~= nil or os.clock() - start > 5

            if response == nil then
                task.cancel(thread)
                return false
            end
    
            -- 426 = Upgrade Required (WebSocket), 200 = HTTP mode
            if response.StatusCode == 426 or response.StatusCode == 200 then
                return true
            end
    
            return false
        end)
    
        if not success then
            return false
        end
    
        return result
    end
end

--// WebSocket Bridge \\--
local WebSocketBridge = setmetatable({}, {__index = BaseBridge}); do
    WebSocketBridge.__index = WebSocketBridge
    
    function WebSocketBridge.new()
        local self = setmetatable({}, WebSocketBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        --// Connect to the server with timeout \\--
        local wsConnection = nil
        local connectionThread = task.spawn(function()
            local success, result = pcall(function()
                return WebSocket.connect("ws://" .. BridgeURL)
            end)
            if success then
                wsConnection = result
            end
        end)
        
        local connectionStart = os.clock()
        repeat task.wait(0.05) until wsConnection ~= nil or os.clock() - connectionStart > 5
        
        if wsConnection == nil then
            task.cancel(connectionThread)
            error("WebSocket connection timed out after 5 seconds")
        end
        
        self.WebSocket = wsConnection
        self.Connected = true
        self.Callbacks = {}
        self.ClientId = nil

        --// Send registration \\--
        self.WebSocket:Send(HttpService:JSONEncode(GetRegistrationInfo()))

        self.AliveThread = task.spawn(function()
            local consecutiveFailures = 0
            while task.wait(1) do
                if not self.Connected then
                    continue
                end

                if self:IsAlive() then
                    consecutiveFailures = 0
                    continue
                end

                consecutiveFailures += 1
                if consecutiveFailures < 3 then
                    continue
                end
                
                self.Connected = false
                break
            end
    
            pcall(function()
                self.WebSocket:Close()
            end)
        end)
    
        --// On Message \\--
        self.WebSocket.OnMessage:Connect(function(message)
            local data = HttpService:JSONDecode(message)

            --// Handle registration response \\--
            if data.type == "registered" then
                self.ClientId = data.clientId
                return
            end

            local response = self:HandleMessage(data)
            if response then
                self.WebSocket:Send(HttpService:JSONEncode(response))
            end
        end)
    
        --// On Close \\--
        self.WebSocket.OnClose:Connect(function()
            self.Connected = false
        end)
    
        return self
    end
    
    function WebSocketBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// HTTP Polling Bridge \\--
local HTTPBridge = setmetatable({}, {__index = BaseBridge}); do
    HTTPBridge.__index = HTTPBridge
    
    function HTTPBridge.new()
        local self = setmetatable({}, HTTPBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        self.Connected = true
        self.Callbacks = {}
        self.PollInterval = 0.1
        self.ClientId = nil

        --// Register with the server \\--
        pcall(function()
            local regResponse = request({
                Url = "http://" .. BridgeURL .. "/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode(GetRegistrationInfo()),
            })
            if regResponse.StatusCode == 200 and regResponse.Body then
                local regData = HttpService:JSONDecode(regResponse.Body)
                self.ClientId = regData.clientId
            end
        end)
    
        --// Start polling thread \\--
        self.PollThread = task.spawn(function()
            local consecutiveFailures = 0
            
            while self.Connected do
                local gotCommands = false
                local success, _ = pcall(function()
                    local pollUrl = "http://" .. BridgeURL .. "/poll"
                    if self.ClientId then
                        pollUrl = pollUrl .. "?clientId=" .. self.ClientId
                    end
                    local response = request({
                        Url = pollUrl,
                        Method = "GET"
                    })

                    --// Server might be down \\--
                    if response.StatusCode ~= 204 and response.StatusCode ~= 200 then
                        consecutiveFailures += 1
                        if consecutiveFailures >= 3 then
                            self.Connected = false
                        end

                        return
                    end
                    
                    consecutiveFailures = 0
    
                    --// Handle response \\--
                    if response.Body and response.Body ~= "" then
                        local data = HttpService:JSONDecode(response.Body)
                        local commands = {}
                        if typeof(data) == "table" and data.type == nil and #data > 0 then
                            commands = data
                        elseif typeof(data) == "table" and data.type ~= nil then
                            commands = { data }
                        end

                        for _, command in ipairs(commands) do
                            gotCommands = true
                            task.spawn(function()
                                local result = self:HandleMessage(command)
                                if result == nil then return end

                                --// Send response back \\--
                                request({
                                    Url = "http://" .. BridgeURL .. "/respond",
                                    Method = "POST",
                                    Headers = {
                                        ["Content-Type"] = "application/json"
                                    },
                                    Body = HttpService:JSONEncode(result)
                                })
                            end)
                        end
                    end
                end)
    
                if not success then
                    consecutiveFailures += 1
                    if consecutiveFailures >= 3 then
                        self.Connected = false
                    end
                end
    
                if not gotCommands then
                    task.wait(self.PollInterval)
                end
            end
        end)
    
        return self
    end
    
    function HTTPBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// Create Bridge \\--
local function CreateBridge()
    if WebSocketAvailable then
        local success, bridge = pcall(function()
            return WebSocketBridge.new()
        end)
        
        if success then
            return bridge
        end
    end

    return HTTPBridge.new()
end

--// Ratelimiter \\--

local Ratelimiter = {}
do
    type RatelimiterOptions = {
        Burst: {
            Time: number,
            Max: number
        },
    
        PeriodicInterval: number?,
        MainCallback: ((...any) -> ...any),
    }

    Ratelimiter.__index = Ratelimiter

    Ratelimiter.new = function(options: RatelimiterOptions)
        local self = setmetatable(options, Ratelimiter)
        self.Bucket = {}
        self.Queue = {}

        self.IsDestroyed = false
        self.ManagerThread = nil
        self.PeriodicThread = nil

        self:SetupManagerThread()

        return self
    end

    Ratelimiter.QueueOperation = function(self, ...: any)
        if self.IsDestroyed then return end
        table.insert(self.Queue, table.pack(...))
    end

    Ratelimiter.SetupManagerThread = function(self)
        if self.IsDestroyed then return end

        self.Bucket = {}
        self.Queue = {}

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        self.ManagerThread = task.spawn(function()
            while not self.IsDestroyed do
                local currentTime = tick()

                --// Clean bucket (efficient rebuild instead of O(n) removal) \\--
                if #self.Bucket > 0 then
                    local newBucket = {}
                    for _, time in self.Bucket do
                        if currentTime - time < self.Burst.Time then
                            table.insert(newBucket, time)
                        end
                    end

                    self.Bucket = newBucket
                end

                --// Process queue \\--
                while #self.Bucket < self.Burst.Max and #self.Queue > 0 do
                    local taskData = table.remove(self.Queue, 1)
                    if taskData then
                        table.insert(self.Bucket, tick())

                        task.defer(function()
                            if self.IsDestroyed then return end
                            self.MainCallback(table.unpack(taskData, 1, taskData.n))
                        end)
                    end
                end

                task.wait()
            end
        end)

        if not self.PeriodicInterval then return end
        self.PeriodicThread = task.spawn(function()
            while not self.IsDestroyed do
                self:QueueOperation()

                task.wait(self.PeriodicInterval)
            end
        end)
    end

    Ratelimiter.Destroy = function(self)
        if self.IsDestroyed then return end
        self.IsDestroyed = true

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        table.clear(self.Bucket)
        table.clear(self.Queue)
    end

    Ratelimiter.Stop = Ratelimiter.Destroy
end

--// Script Source Mapping \\--
local MappedScriptIds = {}
local QueuedScriptIds = {}
local ScriptInstanceMap = setmetatable({}, { __mode = "v" })
local SourcesToMap, SourcesProcessed, MappedSources = 0, 0, 0
local HasStartedMapping = false
local ScriptMappingFinished = false
local ScriptSourceUploadClientId = nil
local MappedSourceLimiter
local ScriptDescendantAddedConnection = nil
local UploadQueue = {}
local UploadQueueDebugIds = {}
local UploadQueueThread = nil
local UploadBatchMax = 8
local UploadFlushInterval = 0.5
local UploadMaxAttempts = 3
local SourceCacheLookupBatchMax = 64
local ScriptHashTimeoutSeconds = 2
local BytecodeTimeoutSeconds = 3
local BuiltInDecompileTimeoutSeconds = 8
local ServerDecompileTimeoutSeconds = 65
local MarkScriptProcessed
local ActiveBridge = nil
local ScriptSourceCacheByHash = {}
local ScriptHashByDebugId = {}

local function IsScriptMappingTransportReady(clientId)
    return (
        ActiveBridge ~= nil and
        ActiveBridge.Connected == true and
        ActiveBridge.ClientId ~= nil and
        ActiveBridge.ClientId == clientId
    )
end

local function UploadScriptSourceBatch(clientId, scripts, hasFinishedMapping)
    if not clientId then return false end
    if not IsScriptMappingTransportReady(clientId) then return false end

    local ok, response = pcall(request, {
        Url = "http://" .. BridgeURL .. "/script-sources",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json"
        },
        Body = HttpService:JSONEncode({
            clientId = clientId,
            scripts = scripts or {},
            hasFinishedMapping = hasFinishedMapping,
            sourcesToMap = SourcesToMap,
            processedSources = SourcesProcessed,
            skippedSources = math.max(0, SourcesProcessed - MappedSources),
        })
    })

    return ok and response and response.StatusCode == 200
end

local function PublishScriptMappingStatus(hasFinishedMapping)
    if hasFinishedMapping ~= nil then
        ScriptMappingFinished = hasFinishedMapping
    end

    return UploadScriptSourceBatch(ScriptSourceUploadClientId, {}, ScriptMappingFinished)
end

local function StartUploadQueue()
    if UploadQueueThread then return end

    UploadQueueThread = task.spawn(function()
        while true do
            if #UploadQueue == 0 or not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then
                task.wait(UploadFlushInterval)
                continue
            end

            local batch = {}
            local debugIds = {}
            while #UploadQueue > 0 and #batch < UploadBatchMax do
                local item = table.remove(UploadQueue, 1)
                table.insert(batch, item)
                table.insert(debugIds, item.debugId)
                UploadQueueDebugIds[item.debugId] = nil
            end

            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, batch, false)
            if uploaded then
                for _, debugId in debugIds do
                    MarkScriptProcessed(debugId, true)
                end
            else
                for idx = #batch, 1, -1 do
                    local item = batch[idx]
                    item.attempts = (item.attempts or 0) + 1
                    if item.attempts >= UploadMaxAttempts then
                        MarkScriptProcessed(item.debugId, false)
                    else
                        UploadQueueDebugIds[item.debugId] = item.debugId
                        table.insert(UploadQueue, 1, item)
                    end
                end
                task.wait(1)
            end

            task.wait()
        end
    end)
end

local function RunWithTimeout(timeoutSeconds, callback)
    local completed = false
    local success = false
    local result = nil

    local worker = task.spawn(function()
        success, result = pcall(callback)
        completed = true
    end)

    local deadline = os.clock() + timeoutSeconds
    while not completed and os.clock() < deadline do
        task.wait(0.05)
    end

    if not completed then
        pcall(task.cancel, worker)
        return false, "Timed out after " .. tostring(timeoutSeconds) .. "s."
    end

    if not success then
        return false, result
    end

    return true, result
end

local function RememberScriptSourceForHash(scriptHash, source)
    if type(scriptHash) ~= "string" or scriptHash == "" then return false end
    if type(source) ~= "string" or source == "" then return false end

    ScriptSourceCacheByHash[scriptHash] = source
    return true
end

local function ReadScriptHash(script)
    if type(GetScriptHash) ~= "function" then return nil end

    local success, result = RunWithTimeout(ScriptHashTimeoutSeconds, function()
        return GetScriptHash(script)
    end)

    if not success or type(result) ~= "string" or result == "" then
        return nil
    end

    return result
end

local function GetScriptHashForInstance(script)
    local debugId = script:GetDebugId()
    if ScriptHashByDebugId[debugId] ~= nil then
        return ScriptHashByDebugId[debugId] or nil
    end

    local scriptHash = ReadScriptHash(script)
    ScriptHashByDebugId[debugId] = scriptHash or false
    return scriptHash
end

local function FetchCachedScriptSourceBatch(clientId, hashesToFetch)
    if #hashesToFetch == 0 then return end

    local ok, response = pcall(request, {
        Url = "http://" .. BridgeURL .. "/script-source-cache",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json",
            ["Accept"] = "application/json",
        },
        Body = HttpService:JSONEncode({
            clientId = clientId,
            hashes = hashesToFetch,
        }),
    })

    if not ok or type(response) ~= "table" or response.StatusCode ~= 200 or type(response.Body) ~= "string" then
        return
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    if not decodedOk or type(decoded) ~= "table" or type(decoded.sources) ~= "table" then
        return
    end

    for _, item in ipairs(decoded.sources) do
        if type(item) == "table" then
            RememberScriptSourceForHash(item.scriptHash, item.source)
        end
    end
end

local function FetchCachedScriptSources(clientId, scriptHashes)
    if type(request) ~= "function" then return end
    if type(clientId) ~= "string" or clientId == "" then return end
    if type(scriptHashes) ~= "table" then return end

    local hashesToFetch = {}
    local seen = {}
    local function flush()
        FetchCachedScriptSourceBatch(clientId, hashesToFetch)
        table.clear(hashesToFetch)
    end

    for _, scriptHash in ipairs(scriptHashes) do
        if type(scriptHash) == "string" and scriptHash ~= "" and not ScriptSourceCacheByHash[scriptHash] and not seen[scriptHash] then
            seen[scriptHash] = true
            table.insert(hashesToFetch, scriptHash)
            if #hashesToFetch >= SourceCacheLookupBatchMax then
                flush()
            end
        end
    end

    flush()
end

local function ReadScriptBytecode(script)
    local success, bytecode = RunWithTimeout(BytecodeTimeoutSeconds, function()
        return getscriptbytecode(script)
    end)
    if not success or bytecode == nil then
        return false, bytecode or "Failed to read script bytecode."
    end
    return true, bytecode
end

local function TryBuiltInDecompile(script)
    if type(BuiltInDecompile) ~= "function" then return nil end

    local startedAt = os.clock()
    local success, source = RunWithTimeout(BuiltInDecompileTimeoutSeconds, function()
        return BuiltInDecompile(script)
    end)
    local latencyMs = math.floor((os.clock() - startedAt) * 1000)
    if not success or type(source) ~= "string" or source == "" then
        return nil
    end

    return StripDecompilerBanner(source), latencyMs
end

local function RequestServerDecompile(bytecode, options)
    if type(request) ~= "function" then
        return nil, "request function is unavailable"
    end

    options = if type(options) == "table" then options else {}
    local body = {
        clientId = ScriptSourceUploadClientId,
        bytecode = base64_encode(bytecode),
        builtinAvailable = type(BuiltInDecompile) == "function",
    }
    if type(options.builtinSource) == "string" then
        body.builtinSource = options.builtinSource
    end
    if type(options.builtinLatencyMs) == "number" then
        body.builtinLatencyMs = options.builtinLatencyMs
    end
    if type(options.requestedProvider) == "string" then
        body.requestedProvider = options.requestedProvider
    end
    if type(options.disabledProviders) == "table" then
        body.disabledProviders = options.disabledProviders
    end

    local success, response = RunWithTimeout(ServerDecompileTimeoutSeconds, function()
        return request({
            Url = "http://" .. BridgeURL .. "/decompile",
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Accept"] = "application/json",
            },
            Body = HttpService:JSONEncode(body),
        })
    end)
    if not success then
        return nil, tostring(response)
    end

    if type(response) ~= "table" or type(response.Body) ~= "string" then
        return nil, "Decompile server returned no response body."
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    if not decodedOk or type(decoded) ~= "table" then
        return nil, "Decompile server returned invalid JSON."
    end

    if decoded.ok == true and type(decoded.source) == "string" and decoded.source ~= "" then
        return StripDecompilerBanner(decoded.source)
    end
    if decoded.needsBuiltin == true and decoded.providerId == "builtin" then
        return nil, nil, true
    end

    if type(decoded.error) == "string" and decoded.error ~= "" then
        return nil, decoded.error
    end
    if type(decoded.attempts) == "table" then
        return nil, table.concat(decoded.attempts, "\n\n")
    end

    return nil, "Decompile server failed without a detailed error."
end

local function PrepareScriptForMapping(script, fetchCache)
    local debugId = script:GetDebugId()
    local scriptHash = GetScriptHashForInstance(script)
    if fetchCache and scriptHash then
        FetchCachedScriptSources(ScriptSourceUploadClientId, { scriptHash })
    end

    local cachedSource = scriptHash and ScriptSourceCacheByHash[scriptHash] or nil
    if cachedSource then
        return {
            debugId = debugId,
            scriptHash = scriptHash,
            source = cachedSource,
        }
    end

    local okBytecode, bytecodeOrError = ReadScriptBytecode(script)
    if not okBytecode then
        return nil, bytecodeOrError
    end

    return {
        debugId = debugId,
        scriptHash = scriptHash,
        bytecode = bytecodeOrError,
    }
end

local function DecompileScriptSource(script, prepared)
    local prepareError
    if not prepared then
        prepared, prepareError = PrepareScriptForMapping(script, true)
    end
    if not prepared then
        return nil, prepareError or "Failed to prepare script for decompile."
    end

    if type(prepared.source) == "string" and prepared.source ~= "" then
        return prepared.source, nil, prepared.scriptHash
    end
    if type(prepared.bytecode) ~= "string" then
        return nil, "Prepared script is missing bytecode.", prepared.scriptHash
    end

    local source, errorMessage, needsBuiltin = RequestServerDecompile(prepared.bytecode)
    if needsBuiltin then
        local builtinSource, builtinLatencyMs = TryBuiltInDecompile(script)
        if builtinSource then
            source, errorMessage = RequestServerDecompile(prepared.bytecode, {
                requestedProvider = "builtin",
                builtinSource = builtinSource,
                builtinLatencyMs = builtinLatencyMs,
            })
        else
            source, errorMessage = RequestServerDecompile(prepared.bytecode, {
                disabledProviders = { "builtin" },
            })
        end
    end
    if not source then
        return nil, errorMessage, prepared.scriptHash
    end

    if prepared.scriptHash then
        RememberScriptSourceForHash(prepared.scriptHash, source)
    end
    return source, nil, prepared.scriptHash
end

MarkScriptProcessed = function(debugId, uploaded)
    if MappedScriptIds[debugId] then return end

    MappedScriptIds[debugId] = true
    QueuedScriptIds[debugId] = nil
    SourcesProcessed += 1
    if uploaded then
        MappedSources += 1
    end

    if SourcesProcessed >= SourcesToMap then
        PublishScriptMappingStatus(true)
    end
end

local function MapScriptSource(script, prepared)
    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] then return end
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local source, _, scriptHash = DecompileScriptSource(script, prepared)
    if not source then
        MarkScriptProcessed(debugId, false)
        return
    end

    ScriptInstanceMap[debugId] = script
    script.Destroying:Once(function()
        ScriptInstanceMap[debugId] = nil
    end)

    if UploadQueueDebugIds[debugId] then return end
    UploadQueueDebugIds[debugId] = debugId
    table.insert(UploadQueue, {
        debugId = debugId,
        path = script:GetFullName(),
        source = source,
        scriptHash = scriptHash,
        attempts = 0,
    })
end

MappedSourceLimiter = Ratelimiter.new({
    Burst = {
        Time = 0.5,
        Max = 4,
    },

    MainCallback = MapScriptSource
})
MappedSourceLimiter:SetupManagerThread()

local function GetScriptByDebugId(debugId)
    local CachedInstance = ScriptInstanceMap[debugId]
    if CachedInstance then
        return CachedInstance
    end

    for _, script in game:QueryDescendants("LuaSourceContainer") do
        if script:IsA("Script") and script.RunContext == Enum.RunContext.Server then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    for _, script in getnilinstances() do
        if not script:IsA("LuaSourceContainer") then continue end

        if script:IsA("Script") and script.RunContext ~= Enum.RunContext.Client then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    return nil
end

local function IsCandidateScriptForMapping(script)
    local IsServerScript = (
        script:IsA("Script") and (
            script.RunContext == Enum.RunContext.Server or
            script.RunContext == Enum.RunContext.Legacy
        )
    )
    if IsServerScript then return false end

    local IsRobloxScript = (
        script.RobloxLocked or
        script:IsDescendantOf(CoreGui) or
        script:IsDescendantOf(CorePackages) or
        script:IsDescendantOf(ScriptContext)
    )
    if IsRobloxScript then return false end

    local debugId = script:GetDebugId()
    local IsAlreadyMapped = MappedScriptIds[debugId]
    if IsAlreadyMapped then return false end

    local IsAlreadyQueued = QueuedScriptIds[debugId]
    if IsAlreadyQueued then return false end

    return true
end

local function QueueScriptForMapping(script, prepared)
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] or QueuedScriptIds[debugId] then return end

    if not prepared then
        prepared = PrepareScriptForMapping(script, true)
    end
    if not prepared then return end

    QueuedScriptIds[debugId] = true
    SourcesToMap += 1
    ScriptMappingFinished = false
    PublishScriptMappingStatus(false)
    MappedSourceLimiter:QueueOperation(script, prepared)
end

local function StartScriptMapping(clientId)
    if HasStartedMapping then return end
    if not IsScriptMappingTransportReady(clientId) then return end

    HasStartedMapping = true
    ScriptSourceUploadClientId = clientId

    ScriptDescendantAddedConnection = game.DescendantAdded:Connect(function(script)
        if not script:IsA("LuaSourceContainer") then
            return
        end

        if not IsCandidateScriptForMapping(script) then return end
        QueueScriptForMapping(script)
    end)

    local CategoriesToMap = {
        game:QueryDescendants("LuaSourceContainer"),
        getnilinstances()
    }

    --// Map script sources \\--
    task.spawn(function()
        if not IsScriptMappingTransportReady(clientId) then return end

        local CandidateScripts = {}
        for _, category in CategoriesToMap do
            for _, script in category do
                if not script:IsA("LuaSourceContainer") then continue end
                if not IsCandidateScriptForMapping(script) then continue end

                table.insert(CandidateScripts, script)
            end
        end

        local hashesToFetch = {}
        for _, script in ipairs(CandidateScripts) do
            local scriptHash = GetScriptHashForInstance(script)
            if scriptHash then
                table.insert(hashesToFetch, scriptHash)
            end
        end
        FetchCachedScriptSources(clientId, hashesToFetch)

        local ValidScripts = {}
        for _, script in ipairs(CandidateScripts) do
            local prepared = PrepareScriptForMapping(script, false)
            if prepared then
                QueuedScriptIds[script:GetDebugId()] = true
                table.insert(ValidScripts, {
                    script = script,
                    prepared = prepared,
                })
            end
        end

        SourcesToMap += #ValidScripts
        PublishScriptMappingStatus(false)

        for idx, item in ValidScripts do
            task.defer(MappedSourceLimiter.QueueOperation, MappedSourceLimiter, item.script, item.prepared)
            if idx % 250 == 0 then task.wait(0.1) end
        end

        if SourcesToMap == 0 then
            PublishScriptMappingStatus(true)
        end
    end)
end

local function ResetScriptMappingState(clientId)
    MappedScriptIds = {}
    QueuedScriptIds = {}
    SourcesToMap = 0
    SourcesProcessed = 0
    MappedSources = 0
    HasStartedMapping = false
    ScriptMappingFinished = false
    ScriptSourceUploadClientId = clientId
    ScriptHashByDebugId = {}

    if ScriptDescendantAddedConnection then
        ScriptDescendantAddedConnection:Disconnect()
        ScriptDescendantAddedConnection = nil
    end

    if MappedSourceLimiter then
        MappedSourceLimiter:SetupManagerThread()
    end

    table.clear(UploadQueue)
    table.clear(UploadQueueDebugIds)
end

local function WaitForBridgeClientId(Bridge)
    local deadline = os.clock() + 5
    repeat
        if Bridge.ClientId then
            return Bridge.ClientId
        end
        if not Bridge.Connected then
            return nil
        end
        task.wait(0.05)
    until os.clock() > deadline

    return nil
end

--// Main Loop \\--
while true do
    local success, Bridge = pcall(CreateBridge)
    
    if not success then
        task.wait(3)
        continue
    end

    local clientId = WaitForBridgeClientId(Bridge)
    if clientId then
        ActiveBridge = Bridge
        StartUploadQueue()

        if ScriptSourceUploadClientId ~= clientId then
            ResetScriptMappingState(clientId)
        end

        if not getgenv().DisableInitialScriptDecompMapping then
            StartScriptMapping(clientId)
        else
            HasStartedMapping = true
            ScriptSourceUploadClientId = clientId
            PublishScriptMappingStatus(true)
        end
    end

    Bridge:BindToType("execute", function(data)
        task.defer(function()
            setthreadidentity(8)
            loadstring(data.source)()
        end)
    end)

    Bridge:BindToTypeRaw("get-console-output", function(data)
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 200))
        local logsOrder = data.logsOrder or "NewestFirst"
        local filter = data.filter
        local hasFilter = typeof(filter) == "string" and filter ~= ""
        local summaryOnly = data.summaryOnly == true

        local logs = LogService:GetLogHistory()
        local results = {}
        local matchedCount = 0
        local countsByLevel = {}

        local function matchesFilter(logEntry)
            if not hasFilter then return true end
            return string.find(logEntry.message, filter, 1, true) ~= nil
        end

        local MAX_LOG_MESSAGE_CHARS = 500
        local function formatLogMessage(message)
            local output = tostring(message or "")
            if #output > MAX_LOG_MESSAGE_CHARS then
                output = string.sub(output, 1, MAX_LOG_MESSAGE_CHARS)
                    .. "…(+" .. (#output - MAX_LOG_MESSAGE_CHARS) .. " chars omitted)"
            end
            return output
        end

        if logsOrder == "NewestFirst" then
            for i = #logs, 1, -1 do
                local logEntry = logs[i]
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                local levelName = logEntry.messageType and logEntry.messageType.Name or "Unknown"
                countsByLevel[levelName] = (countsByLevel[levelName] or 0) + 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        else
            for _, logEntry in logs do
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                local levelName = logEntry.messageType and logEntry.messageType.Name or "Unknown"
                countsByLevel[levelName] = (countsByLevel[levelName] or 0) + 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        end

        local outputLines = {}
        if summaryOnly then
            table.insert(outputLines, string.format("Matched %d logs.", matchedCount))
            for levelName, count in countsByLevel do
                table.insert(outputLines, string.format("%s: %d", levelName, count))
            end
            return table.concat(outputLines, "\n")
        end

        table.insert(outputLines, string.format("Displaying %d/%d logs:", #results, matchedCount))

        for _, logEntry in results do
            table.insert(outputLines, string.format(
                "[%s t=%s] %s",
                logEntry.messageType.Name, tostring(logEntry.timestamp),
                formatLogMessage(logEntry.message)
            ))
        end

        return table.concat(outputLines, "\n")
    end)

    Bridge:BindToType("get-data-by-code", function(data)
        setthreadidentity(8)
        local dataOutput = table.pack(loadstring(data.source)())

        return dataOutput
    end)

    Bridge:BindToTypeRaw("get-script-content", function(data)
        local source
        local scriptInstance

        --// Handle GC'd script proxies: debugId is passed directly, skip loadstring \\--
        if data.debugId then
            scriptInstance = GetScriptByDebugId(data.debugId)
            assert(scriptInstance, "No live script instance found for ScriptProxy with DebugId: " .. tostring(data.debugId))
        else
            setthreadidentity(8)
            scriptInstance = loadstring(data.source)()

            assert(typeof(scriptInstance) == "Instance", "Script instance is not an instance.")
            assert(scriptInstance:IsA("LuaSourceContainer"), "Script instance is not a LuaSourceContainer (Script, LocalScript, or ModuleScript).")
            assert(not (scriptInstance:IsA("Script") and scriptInstance.RunContext == Enum.RunContext.Server), "Script instance is a Server Script.")
        end

        local scriptHash
        source, _, scriptHash = DecompileScriptSource(scriptInstance)
        assert(source, "Failed to decompile script.")

        local debugId = scriptInstance:GetDebugId()
        if ScriptSourceUploadClientId and not MappedScriptIds[debugId] then
            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, {
                {
                    debugId = debugId,
                    path = scriptInstance:GetFullName(),
                    source = source,
                    scriptHash = scriptHash,
                }
            }, ScriptMappingFinished)

            if uploaded then
                MappedScriptIds[debugId] = true
            end
        end

        --// Line range support with bounded default preview \\--
        local lines = {}
        local pos = 1
        local len = #source
        while pos <= len do
            local newlinePos = source:find("\n", pos, true)
            if newlinePos then
                table.insert(lines, source:sub(pos, newlinePos - 1))
                pos = newlinePos + 1
            else
                table.insert(lines, source:sub(pos))
                break
            end
        end

        local totalLines = #lines
        local maxLines = math.max(1, math.min(tonumber(data.maxLines) or 200, 2000))
        local startLine = data.startLine and math.max(1, math.min(data.startLine, totalLines)) or 1
        local requestedEndLine = data.endLine and math.max(startLine, math.min(data.endLine, totalLines)) or totalLines
        local endLine = math.min(requestedEndLine, startLine + maxLines - 1)

        local sliced = {}
        for i = startLine, endLine do
            table.insert(sliced, lines[i])
        end

        local footer = ""
        if endLine < requestedEndLine then
            footer = "\n-- Output truncated to " .. maxLines .. " lines. Rerun with startLine=" .. (endLine + 1) .. " or a tighter range to continue."
        end

        return "-- Lines " .. startLine .. "-" .. endLine .. " of " .. totalLines .. "\n" .. table.concat(sliced, "\n") .. footer
    end)

    Bridge:BindToType("search-instances", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        local instances = rootInstance:QueryDescendants(data.selector)
        
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 100))
        local results = {}
        
        for i, instance in instances do
            if i > limit then break end

            local fullName = instance.Name
            pcall(function() fullName = instance:GetFullName() end)

            table.insert(results, {
                Name = instance.Name,
                ClassName = instance.ClassName,
                Path = fullName,
                DebugId = instance:GetDebugId()
            })
        end
        
        return {
            count = #instances,
            limited = #instances > limit,
            results = results
        }
    end)

    Bridge:BindToType("inspect-instances", function(data)
        local paths = data.paths
        assert(typeof(paths) == "table" and #paths > 0, "paths must contain at least one instance path.")

        local maxPaths = math.min(#paths, 25)
        local maxChildren = math.max(0, math.min(tonumber(data.maxChildren) or 20, 100))
        local includeAttributes = data.includeAttributes ~= false
        local includeTags = data.includeTags ~= false
        local includeChildren = data.includeChildren ~= false
        local requestedProperties = data.properties

        local function AddUnique(target, seen, values)
            for _, propertyName in ipairs(values) do
                if not seen[propertyName] then
                    seen[propertyName] = true
                    table.insert(target, propertyName)
                end
            end
        end

        local function GetDefaultProperties(instance)
            local properties = {}
            local seen = {}
            AddUnique(properties, seen, { "Archivable" })

            if instance:IsA("BasePart") then
                AddUnique(properties, seen, {
                    "Anchored", "CanCollide", "CanQuery", "CanTouch", "CastShadow",
                    "CFrame", "Position", "Size", "Color", "Material", "Transparency",
                    "AssemblyLinearVelocity", "AssemblyAngularVelocity",
                })
            end
            if instance:IsA("Model") then
                AddUnique(properties, seen, { "PrimaryPart", "WorldPivot" })
            end
            if instance:IsA("GuiObject") then
                AddUnique(properties, seen, {
                    "Visible", "Active", "Position", "Size", "AnchorPoint", "ZIndex",
                    "BackgroundColor3", "BackgroundTransparency",
                })
            end
            if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
                AddUnique(properties, seen, { "Text", "TextColor3", "TextSize", "TextTransparency" })
            end
            if instance:IsA("ValueBase") then
                AddUnique(properties, seen, { "Value" })
            end
            if instance:IsA("Humanoid") then
                AddUnique(properties, seen, {
                    "Health", "MaxHealth", "WalkSpeed", "JumpPower", "AutoRotate", "RigType",
                    "MoveDirection", "FloorMaterial",
                })
            end
            if instance:IsA("BaseScript") then
                AddUnique(properties, seen, { "Enabled", "RunContext" })
            end
            if instance:IsA("Sound") then
                AddUnique(properties, seen, { "SoundId", "Volume", "PlaybackSpeed", "Playing", "TimePosition" })
            end
            if instance:IsA("Animation") then
                AddUnique(properties, seen, { "AnimationId" })
            end
            if instance:IsA("Decal") or instance:IsA("Texture") then
                AddUnique(properties, seen, { "Texture", "Color3", "Transparency" })
            end
            if instance:IsA("MeshPart") then
                AddUnique(properties, seen, { "MeshId", "TextureID" })
            end
            if instance:IsA("ProximityPrompt") then
                AddUnique(properties, seen, {
                    "ActionText", "ObjectText", "Enabled", "HoldDuration",
                    "KeyboardKeyCode", "MaxActivationDistance", "RequiresLineOfSight",
                })
            end

            return properties
        end

        local function ReadProperties(instance, propertyNames)
            local values = {}
            local unreadable = {}

            for index, propertyName in ipairs(propertyNames) do
                if index > 50 then break end
                if typeof(propertyName) ~= "string" or propertyName == "" then continue end

                local ok, value = pcall(function()
                    return instance[propertyName]
                end)
                if ok then
                    values[propertyName] = value
                else
                    table.insert(unreadable, propertyName)
                end
            end

            return values, unreadable
        end

        local results = {}
        for index = 1, maxPaths do
            local path = paths[index]
            local ok, result = pcall(function()
                assert(typeof(path) == "string" and path ~= "", "Instance path must be a non-empty string.")
                local instance = loadstring("return " .. path)()
                assert(typeof(instance) == "Instance", "Path did not resolve to an Instance.")

                local propertyNames = requestedProperties
                if typeof(propertyNames) ~= "table" or #propertyNames == 0 then
                    propertyNames = GetDefaultProperties(instance)
                end
                local properties, unreadableProperties = ReadProperties(instance, propertyNames)

                local children = nil
                local childCount = #instance:GetChildren()
                if includeChildren then
                    children = {}
                    for childIndex, child in ipairs(instance:GetChildren()) do
                        if childIndex > maxChildren then break end
                        table.insert(children, {
                            Name = child.Name,
                            ClassName = child.ClassName,
                            Path = child:GetFullName(),
                            DebugId = child:GetDebugId(),
                            ChildCount = #child:GetChildren(),
                        })
                    end
                end

                return {
                    Name = instance.Name,
                    ClassName = instance.ClassName,
                    Path = instance:GetFullName(),
                    DebugId = instance:GetDebugId(),
                    Parent = instance.Parent,
                    ChildCount = childCount,
                    ChildrenLimited = includeChildren and childCount > maxChildren or false,
                    Properties = properties,
                    UnreadableProperties = #unreadableProperties > 0 and unreadableProperties or nil,
                    Attributes = includeAttributes and instance:GetAttributes() or nil,
                    Tags = includeTags and CollectionService:GetTags(instance) or nil,
                    Children = children,
                }
            end)

            if ok then
                table.insert(results, result)
            else
                table.insert(results, {
                    RequestedPath = tostring(path),
                    Error = tostring(result),
                })
            end
        end

        return {
            count = #results,
            results = results,
        }
    end)

    Bridge:BindToType("get-game-info", function(data)
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)

        local info = {
            -- IDs are strings so JSON/Lua encoders never render them in
            -- scientific notation or lose integer precision downstream.
            PlaceId = tostring(game.PlaceId),
            GameId = tostring(game.GameId),
            PlaceVersion = game.PlaceVersion,
            PlaceName = productInfo.Name,
            Creator = productInfo.Creator.Name,
            CreatorType = tostring(productInfo.Creator.CreatorType),
            CreatorId = tostring(productInfo.Creator.CreatorTargetId),
            JobId = game.JobId,
            ServerType = RobloxReplicatedStorage.GetServerType:InvokeServer()
        }

        -- The marketplace description can be multi-kB of marketing text that is
        -- pure noise for debugging, so omit it unless explicitly requested.
        if data.includeDescription == true then
            info.PlaceDescription = productInfo.Description
        end

        return info
    end)

    Bridge:BindToType("get-descendants-tree", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        assert(typeof(rootInstance) == "Instance", "Root path did not resolve to a valid Instance.")

        local maxDepth = math.max(0, math.min(tonumber(data.maxDepth) or 2, 5))
        local maxChildren = math.max(1, math.min(tonumber(data.maxChildren) or 20, 30))
        local classFilter = data.classFilter or ""
        local hasFilter = classFilter ~= ""
        local summaryOnly = data.summaryOnly == true
        local MAX_TREE_NODES = 300
        local nodeBudget = MAX_TREE_NODES
        local budgetHit = false

        if summaryOnly then
            local classCounts = {}
            local visited = 0
            local matched = 0

            local function walk(instance, depth)
                if depth > maxDepth then
                    return
                end

                for _, child in instance:GetChildren() do
                    visited += 1
                    if not hasFilter or child:IsA(classFilter) then
                        matched += 1
                        classCounts[child.ClassName] = (classCounts[child.ClassName] or 0) + 1
                    end
                    if depth < maxDepth then
                        walk(child, depth + 1)
                    end
                end
            end

            walk(rootInstance, 1)

            return {
                Root = {
                    Name = rootInstance.Name,
                    ClassName = rootInstance.ClassName,
                    ChildCount = #rootInstance:GetChildren(),
                },
                MaxDepth = maxDepth,
                ClassFilter = if hasFilter then classFilter else nil,
                VisitedDescendants = visited,
                MatchedDescendants = matched,
                ClassCounts = classCounts,
            }
        end

        local function buildTree(instance, depth)
            if depth > maxDepth then
                return nil
            end

            local children = instance:GetChildren()
            local childNodes = {}
            local shown = 0
            local total = #children

            for _, child in children do
                if shown >= maxChildren then break end
                if nodeBudget <= 0 then
                    budgetHit = true
                    break
                end

                if hasFilter and not child:IsA(classFilter) then
                    -- Even if this child doesn't match, check if any descendant might
                    -- Only skip if we're at max depth anyway
                    if depth < maxDepth then
                        local subtree = buildTree(child, depth + 1)
                        if subtree and subtree.Children and #subtree.Children > 0 then
                            table.insert(childNodes, subtree)
                            shown += 1
                        end
                    end
                    continue
                end

                nodeBudget -= 1

                local node = {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    ChildCount = #child:GetChildren()
                }

                if depth < maxDepth and node.ChildCount > 0 then
                    local subtree = buildTree(child, depth + 1)
                    if subtree then
                        node.Children = subtree.Children
                    end
                end

                table.insert(childNodes, node)
                shown += 1
            end

            return {
                Name = instance.Name,
                ClassName = instance.ClassName,
                ChildCount = total,
                TruncatedAt = if shown < total then shown else nil,
                Children = childNodes
            }
        end

        local tree = buildTree(rootInstance, 0)
        if budgetHit and typeof(tree) == "table" then
            tree.Note = "Output capped at " .. MAX_TREE_NODES .. " nodes. Narrow with classFilter, lower maxDepth, or summaryOnly=true."
        end
        return tree
    end)

    Bridge:BindToType("ensure-remote-spy", function(data)
        if getgenv().Cobalt then
            return {
                status = "already_loaded",
                message = "Cobalt remote spy is already running."
            }
        end

        -- Load Cobalt
        local success, err = pcall(function()
            loadstring(game:HttpGet("https://github.com/notpoiu/cobalt/releases/latest/download/Cobalt.luau"))()
        end)

        if not success then
            error("Failed to load Cobalt: " .. tostring(err))
        end

        -- Wait for Cobalt to initialize
        local waitStart = os.clock()
        while not getgenv().Cobalt and os.clock() - waitStart < 10 do
            task.wait(0.1)
        end

        assert(getgenv().Cobalt, "Cobalt loaded but failed to initialize within 10 seconds.")
        
        return {
            status = "loaded",
            message = "Cobalt remote spy loaded successfully."
        }
    end)

    Bridge:BindToType("get-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local direction = data.direction or "Both"
        local nameFilter = data.remoteNameFilter or ""
        local limit = math.max(1, math.min(tonumber(data.limit) or 10, 100))
        local maxCallsPerRemote = math.max(0, math.min(tonumber(data.maxCallsPerRemote) or 2, 20))
        local summaryOnly = data.summaryOnly == true
        local hasNameFilter = nameFilter ~= ""

        local function ProcessLogs(logTable, directionLabel)
            local results = {}

            for instance, log in logTable do
                if typeof(instance) ~= "Instance" then continue end
                if #results >= limit then break end

                local remoteName = ""
                local remoteClass = ""
                pcall(function()
                    remoteName = instance.Name
                    remoteClass = instance.ClassName
                end)

                -- Apply name filter
                if hasNameFilter and not string.find(string.lower(remoteName), string.lower(nameFilter), 1, true) then
                    continue
                end

                -- Get recent calls (raw — LuaEncode handles serialization)
                local recentCalls = {}
                local totalCalls = #log.Calls
                local startIdx = math.max(1, totalCalls - maxCallsPerRemote + 1)

                if not summaryOnly then
                    for i = startIdx, totalCalls do
                        local call = log.Calls[i]
                        if not call then continue end

                        table.insert(recentCalls, {
                            Index = i,
                            Arguments = call.Arguments,
                            Origin = call.Origin,
                            IsExecutor = call.IsExecutor or false,
                            IsActor = call.IsActor or false,
                            Line = call.Line,
                        })
                    end
                end

                table.insert(results, {
                    RemoteName = remoteName,
                    RemoteClass = remoteClass,
                    Direction = directionLabel,
                    Method = log.Method,
                    TotalCalls = totalCalls,
                    Ignored = log.Ignored,
                    Blocked = log.Blocked,
                    RecentCalls = if summaryOnly then nil else recentCalls,
                })
            end

            return results
        end

        local allResults = {}

        if direction == "Outgoing" or direction == "Both" then
            local outgoing = ProcessLogs(Cobalt.shared.Logs.Outgoing, "Outgoing")
            for _, r in outgoing do
                table.insert(allResults, r)
            end
        end

        if direction == "Incoming" or direction == "Both" then
            local incoming = ProcessLogs(Cobalt.shared.Logs.Incoming, "Incoming")
            for _, r in incoming do
                table.insert(allResults, r)
            end
        end

        -- Sort by total calls descending (most active remotes first)
        table.sort(allResults, function(a, b)
            return a.TotalCalls > b.TotalCalls
        end)

        -- Trim to limit
        if #allResults > limit then
            local trimmed = {}
            for i = 1, limit do
                trimmed[i] = allResults[i]
            end
            allResults = trimmed
        end

        return {
            count = #allResults,
            results = allResults
        }
    end)

    Bridge:BindToType("clear-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.ClearLogs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        Cobalt.shared.ClearLogs()

        return {
            status = "cleared",
            message = "All remote spy logs have been cleared."
        }
    end)

    Bridge:BindToType("block-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldBlock = data.shouldBlock

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldBlock and not log.Blocked then
                    log:Block()
                elseif not shouldBlock and log.Blocked then
                    log:Block() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldBlock and "Blocked" or "Unblocked") .. " remote: " .. remoteName,
                    blocked = log.Blocked
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToType("ignore-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldIgnore = data.shouldIgnore

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldIgnore and not log.Ignored then
                    log:Ignore()
                elseif not shouldIgnore and log.Ignored then
                    log:Ignore() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldIgnore and "Ignoring" or "Unignored") .. " remote: " .. remoteName,
                    ignored = log.Ignored
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    -- Keep Cobalt's implementation details behind one public MCP operation.
    -- The legacy callbacks above remain internal so this dispatcher can reuse
    -- their validated filtering and state-change behavior.
    Bridge:BindToType("remote-spy", function(data)
        Bridge.Callbacks["ensure-remote-spy"]({})

        local operation = data.operation
        if operation == "status" then
            local Cobalt = getgenv().Cobalt
            local function CountLogs(logTable)
                local count = 0
                if typeof(logTable) ~= "table" then return count end
                for _ in logTable do
                    count += 1
                end
                return count
            end

            return {
                status = "loaded",
                outgoingRemotes = CountLogs(Cobalt.shared and Cobalt.shared.Logs and Cobalt.shared.Logs.Outgoing),
                incomingRemotes = CountLogs(Cobalt.shared and Cobalt.shared.Logs and Cobalt.shared.Logs.Incoming),
            }
        elseif operation == "list" then
            return Bridge.Callbacks["get-remote-spy-logs"]({
                direction = data.direction,
                remoteNameFilter = data.nameFilter,
                limit = data.limit,
                maxCallsPerRemote = data.maxCallsPerRemote,
                summaryOnly = data.summaryOnly,
            })
        elseif operation == "clear" then
            return Bridge.Callbacks["clear-remote-spy-logs"]({})
        elseif operation == "block" or operation == "unblock" then
            return Bridge.Callbacks["block-remote"]({
                remoteName = data.remoteName,
                direction = data.direction,
                shouldBlock = operation == "block",
            })
        elseif operation == "ignore" or operation == "unignore" then
            return Bridge.Callbacks["ignore-remote"]({
                remoteName = data.remoteName,
                direction = data.direction,
                shouldIgnore = operation == "ignore",
            })
        end

        error("Invalid remote-spy operation: " .. tostring(operation))
    end)

    Bridge:BindToType("type-text-box", function(data)
        local path = data.path
        local text = data.string or data.text
        local enter = data.enter
        local useKeyPress = data.useKeyPress

        local textBox
        if typeof(path) == "string" then
            textBox = loadstring("return " .. path)()
        else
            textBox = path
        end
        
        assert(typeof(textBox) == "Instance", "Path did not resolve to a valid Instance.")
        assert(textBox:IsA("TextBox"), "Resolved Instance is not a TextBox.")

        textBox:CaptureFocus()
        task.wait(0.05)
        
        if useKeyPress then
            local success = pcall(function()
                for i = 1, #text do
                    VirtualInputManager:SendTextInput(text:sub(i, i), nil, game)
                    task.wait(0.01)
                end
            end)
            
            if not success and type(keypress) == "function" then
                for i = 1, #text do
                    local char = text:sub(i, i):upper()
                    local byte = char:byte()
                    if byte then
                        keypress(byte)
                        task.wait(0.01)
                        if type(keyrelease) == "function" then
                            keyrelease(byte)
                        end
                    end
                end
            end
        else
            textBox.Text = text
        end

        if enter then
            if useKeyPress then
                if type(keypress) == "function" then
                    keypress(0x0D)
                    task.wait(0.01)
                    if type(keyrelease) == "function" then
                        keyrelease(0x0D)
                    end
                else
                    pcall(function()
                        VirtualInputManager:SendKeyEvent(true, Enum.KeyCode.Return, false, game)
                        task.wait(0.01)
                        VirtualInputManager:SendKeyEvent(false, Enum.KeyCode.Return, false, game)
                    end)
                end
            end
            textBox:ReleaseFocus(true)
        else
            textBox:ReleaseFocus(false)
        end

        return {
            status = "success",
            message = "Successfully typed into TextBox."
        }
    end)

    Bridge:BindToType("click-button", function(data)
        local path = data.path
        local action = data.Action or data.action

        local button
        if typeof(path) == "string" then
            button = loadstring("return " .. path)()
        else
            button = path
        end

        assert(typeof(button) == "Instance", "Path did not resolve to a valid Instance.")
        assert(button:IsA("GuiButton"), "Resolved Instance is not a GuiButton (e.g., TextButton or ImageButton).")
        assert(typeof(firesignal) == "function", "Your executor does not support 'firesignal', which is required for this command.")

        local Signals = {"Activated", "MouseButton1Down", "MouseButton2Down", "MouseButton1Click", "MouseButton2Click"}
        
        if action then
            assert(table.find(Signals, action), "Invalid action provided. Valid actions are: " .. table.concat(Signals, ", "))
            firesignal(button[action])
        else
            for _, signalName in pairs(Signals) do
                pcall(function() firesignal(button[signalName]) end)
            end
        end

        return {
            status = "success",
            message = "Successfully fired click signals on Button."
        }
    end)

    Bridge:WaitForDisconnect()

    if ActiveBridge == Bridge then
        ActiveBridge = nil
    end
    
    task.wait(1)
end
