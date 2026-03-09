--[[
    Open Clip - Auto-Recorder Script

    Reads state from a game_state file written by the Open Clip desktop app.
    Very lightweight - just file reads, no process scanning.

    Setup:
    1. Open OBS → Tools → Scripts → "+", and add this file.
    2. The path below should auto-populate to your AppData folder.
       If not, paste the path shown in the app under Settings → OBS Script Setup.
    3. Run the Open Clip app and enable the watcher.
]]

obs = obslua

-- Settings
local state_file_path = ""
local check_interval = 50  -- ms
local last_state = ""
local is_recording = false
local current_game = ""
local previous_scene = ""  -- Track previous scene to restore after recording

-- Get default path from AppData (where Open Clip stores its runtime files)
function get_default_state_path()
    -- Primary: %APPDATA%\open-clip\runtime\game_state
    local appdata = os.getenv("APPDATA")
    if appdata then
        return appdata .. "\\open-clip\\runtime\\game_state"
    end
    -- Fallback: derive via USERPROFILE
    local user_profile = os.getenv("USERPROFILE")
    if user_profile then
        return user_profile .. "\\AppData\\Roaming\\open-clip\\runtime\\game_state"
    end
    return "C:\\game_state"
end

-- Read first line from file
function read_state_file()
    if state_file_path == "" then
        return nil
    end

    local file = io.open(state_file_path, "r")
    if file == nil then
        return nil
    end
    local content = file:read("*line")
    file:close()
    return content
end

-- Check if file exists
function file_exists(path)
    local f = io.open(path, "r")
    if f then
        f:close()
        return true
    end
    return false
end

-- Split string by delimiter
function split(str, delim)
    if str == nil then
        return {}
    end
    local result = {}
    for match in (str .. delim):gmatch("(.-)" .. delim) do
        table.insert(result, match)
    end
    return result
end

-- Get current scene name
function get_current_scene_name()
    local scene = obs.obs_frontend_get_current_scene()
    if scene then
        local name = obs.obs_source_get_name(scene)
        obs.obs_source_release(scene)
        return name
    end
    return nil
end

-- Switch to a scene by name
function switch_to_scene(scene_name)
    if scene_name == nil or scene_name == "" then
        return false
    end

    local scenes = obs.obs_frontend_get_scenes()
    if scenes then
        for _, scene in ipairs(scenes) do
            local name = obs.obs_source_get_name(scene)
            if name == scene_name then
                obs.obs_frontend_set_current_scene(scene)
                obs.script_log(obs.LOG_INFO, "Switched to scene: " .. scene_name)
                obs.source_list_release(scenes)
                return true
            end
        end
        obs.source_list_release(scenes)
    end

    obs.script_log(obs.LOG_WARNING, "Scene not found: " .. scene_name)
    return false
end

-- Main loop - called every check_interval ms
function check_state()
    local state = read_state_file()

    if state == nil or state == last_state then
        return
    end

    last_state = state

    local parts = split(state, "|")
    local status = parts[1]
    local game_name = parts[2] or ""
    local scene_name = parts[3] or ""

    local recording_active = obs.obs_frontend_recording_active()

    if status == "RECORDING" and not recording_active and not is_recording then
        -- Start recording
        obs.script_log(obs.LOG_INFO, "Game detected: " .. game_name .. " - Starting recording")

        -- Switch scene if specified
        if scene_name ~= "" then
            previous_scene = get_current_scene_name()
            if previous_scene then
                obs.script_log(obs.LOG_INFO, "Saving previous scene: " .. previous_scene)
            end
            switch_to_scene(scene_name)
        end

        obs.obs_frontend_recording_start()
        is_recording = true
        current_game = game_name

    elseif status ~= "RECORDING" and is_recording then
        -- Stop recording
        obs.script_log(obs.LOG_INFO, "Game closed: " .. current_game .. " - Stopping recording")
        obs.obs_frontend_recording_stop()
        is_recording = false
        current_game = ""

        -- Restore previous scene if we switched
        if previous_scene ~= "" then
            obs.script_log(obs.LOG_INFO, "Restoring previous scene: " .. previous_scene)
            switch_to_scene(previous_scene)
            previous_scene = ""
        end

    elseif status == "STOPPED" then
        -- Watcher stopped
        if is_recording then
            obs.script_log(obs.LOG_WARNING, "Game watcher stopped while recording!")
        end
    end
end

-- Script description
function script_description()
    return [[
<h2>Open Clip - Auto-Recorder</h2>
<p>Automatically starts and stops recording when your configured games are running.</p>
<p>Supports automatic scene switching per game.</p>
<hr>
<p><b>Setup:</b></p>
<ol>
<li>Open <b>Open Clip</b> and start the watcher.</li>
<li>The state file path below should auto-populate. If not, copy it from
    <b>Settings → OBS Script Setup</b> in the app.</li>
</ol>
<p><small>Uses file-based communication — minimal CPU impact.</small></p>
]]
end

-- Script properties
function script_properties()
    local props = obs.obs_properties_create()

    -- Path to state file
    obs.obs_properties_add_path(props, "state_file_path", "State File Path",
        obs.OBS_PATH_FILE, "State File (game_state)", nil)

    -- Check interval
    obs.obs_properties_add_int(props, "check_interval", "Check Interval (ms)", 20, 1000, 10)

    -- Status info
    local status_text = "Status: "
    if state_file_path ~= "" and file_exists(state_file_path) then
        local state = read_state_file()
        if state then
            status_text = status_text .. "Connected (" .. state .. ")"
        else
            status_text = status_text .. "File exists but empty"
        end
    else
        status_text = status_text .. "State file not found — is the watcher running?"
    end

    obs.obs_properties_add_text(props, "status_info", status_text, obs.OBS_TEXT_INFO)

    return props
end

-- Script defaults
function script_defaults(settings)
    local default_path = get_default_state_path()
    obs.obs_data_set_default_string(settings, "state_file_path", default_path)
    obs.obs_data_set_default_int(settings, "check_interval", 50)
end

-- Script update (called when settings change)
function script_update(settings)
    -- Remove old timer
    obs.timer_remove(check_state)

    -- Get settings
    state_file_path = obs.obs_data_get_string(settings, "state_file_path")
    check_interval = obs.obs_data_get_int(settings, "check_interval")

    -- Log status
    if state_file_path == "" then
        obs.script_log(obs.LOG_WARNING, "State file path not set!")
    elseif file_exists(state_file_path) then
        obs.script_log(obs.LOG_INFO, "State file found: " .. state_file_path)
        obs.timer_add(check_state, check_interval)
    else
        obs.script_log(obs.LOG_WARNING, "State file not found: " .. state_file_path)
        obs.script_log(obs.LOG_WARNING, "Make sure Open Clip is running with the watcher active!")
        -- Still start timer in case file appears later
        obs.timer_add(check_state, check_interval)
    end
end

-- Vendor request handler for ping (allows the app to detect this script is loaded)
function vendor_ping(data)
    return "{}"
end

-- Script load
function script_load(settings)
    obs.script_log(obs.LOG_INFO, "Open Clip recorder loaded")

    -- Register a vendor WebSocket request so the desktop app can detect this script
    local vendor = obs.obs_websocket_register_vendor("open-clip")
    if vendor then
        obs.obs_websocket_vendor_register_request(vendor, "ping", vendor_ping)
        obs.script_log(obs.LOG_INFO, "Registered WebSocket vendor 'open-clip' for script detection")
    end
end

-- Script unload
function script_unload()
    obs.timer_remove(check_state)
    obs.script_log(obs.LOG_INFO, "Open Clip recorder unloaded")
end
