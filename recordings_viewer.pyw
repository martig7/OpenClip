"""
Recordings Viewer - Local Web Application
Flask server that provides a modern web interface for viewing game recordings and clips.
"""

from flask import Flask, send_from_directory, jsonify, request, Response
import os
import json
import re
import subprocess
from datetime import datetime
from configparser import ConfigParser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = os.path.join(SCRIPT_DIR, "runtime")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "manager_settings.json")
CONFIG_FILE = os.path.join(SCRIPT_DIR, "games_config.json")
STATIC_FOLDER = os.path.join(SCRIPT_DIR, "static")
MARKERS_FILE = os.path.join(RUNTIME_DIR, "clip_markers.json")

# Ensure runtime directory exists
os.makedirs(RUNTIME_DIR, exist_ok=True)

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.flv', '.mov', '.avi', '.ts'}
MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.flv': 'video/x-flv',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/mp2t',
}

app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path='')

# Store allowed paths for security validation
allowed_paths = set()


def load_settings():
    """Load manager settings."""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {
        "organized_path": "",
        "auto_organize": True,
        "storage_settings": {
            "auto_delete_enabled": False,
            "max_storage_gb": 100,
            "max_age_days": 30,
            "exclude_clips": True
        },
        "locked_recordings": []
    }


def save_settings(settings):
    """Save manager settings."""
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False


def load_games_config():
    """Load games configuration."""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"games": []}


def load_markers():
    """Load clip markers from file."""
    try:
        if os.path.exists(MARKERS_FILE):
            with open(MARKERS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"markers": []}


def save_markers(markers):
    """Save clip markers to file."""
    try:
        with open(MARKERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(markers, f, indent=2)
        return True
    except:
        return False


def get_video_duration(file_path):
    """Get video duration using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            file_path
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if result.returncode == 0:
            return float(result.stdout.strip())
    except:
        pass
    return None


def get_audio_tracks(file_path):
    """Get audio track info from a video file using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-show_streams', '-select_streams', 'a',
            '-of', 'json',
            file_path
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if result.returncode != 0:
            return []

        data = json.loads(result.stdout)
        tracks = []
        for i, stream in enumerate(data.get('streams', [])):
            tags = stream.get('tags', {})
            title = tags.get('title') or tags.get('handler_name') or f'Track {i + 1}'
            tracks.append({
                'index': i,
                'stream_index': stream.get('index', i),
                'codec_name': stream.get('codec_name', 'unknown'),
                'channels': stream.get('channels', 0),
                'channel_layout': stream.get('channel_layout', ''),
                'sample_rate': stream.get('sample_rate', ''),
                'title': title,
            })
        return tracks
    except:
        return []


def get_markers_for_recording(game_name, file_mtime, duration):
    """Get markers that belong to a specific recording."""
    markers_data = load_markers()
    all_markers = markers_data.get("markers", [])

    if not duration:
        return []

    # Calculate recording time window
    recording_end = file_mtime
    recording_start = recording_end - duration

    matching_markers = []
    for marker in all_markers:
        # Match by game name and timestamp within recording window
        if marker.get("game_name") == game_name:
            marker_time = marker.get("timestamp", 0)
            if recording_start <= marker_time <= recording_end:
                # Calculate position in video (seconds from start)
                position = marker_time - recording_start
                matching_markers.append({
                    "position": position,
                    "timestamp": marker_time,
                    "created_at": marker.get("created_at", "")
                })

    # Sort by position
    matching_markers.sort(key=lambda m: m["position"])
    return matching_markers


def get_obs_recording_path():
    """Find OBS recording path from OBS configuration."""
    appdata = os.getenv('APPDATA', '')
    profiles_dir = os.path.join(appdata, 'obs-studio', 'basic', 'profiles')

    if os.path.exists(profiles_dir):
        for profile in os.listdir(profiles_dir):
            basic_ini = os.path.join(profiles_dir, profile, 'basic.ini')
            if os.path.exists(basic_ini):
                try:
                    config = ConfigParser()
                    config.read(basic_ini, encoding='utf-8-sig')
                    for section in ['SimpleOutput', 'AdvOut']:
                        if config.has_section(section):
                            for key in ['filepath', 'recfilepath']:
                                if config.has_option(section, key):
                                    path = config.get(section, key)
                                    if path and os.path.exists(path):
                                        return path
                except:
                    continue

    # Fallback
    user_profile = os.getenv('USERPROFILE', '')
    for path in [os.path.join(user_profile, 'Videos'), os.path.join(user_profile, 'Videos', 'OBS')]:
        if os.path.exists(path):
            return path
    return None


def get_clips_path():
    """Get the clips folder path (subfolder of organized_path)."""
    settings = load_settings()
    organized_path = settings.get('organized_path', '')

    if not organized_path:
        organized_path = get_obs_recording_path()

    if organized_path:
        clips_path = os.path.join(organized_path, 'Clips')
        return clips_path

    return None


def format_file_size(size_bytes):
    """Convert bytes to human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def parse_recording_info(file_path, game_name):
    """Extract metadata from a recording file."""
    try:
        stat = os.stat(file_path)
        filename = os.path.basename(file_path)

        # Try to parse date from filename: "Game Session YYYY-MM-DD #N.ext"
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', filename)
        if date_match:
            session_date = date_match.group(1)
        else:
            session_date = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d")

        return {
            'path': file_path,
            'filename': filename,
            'game_name': game_name,
            'date': session_date,
            'size_bytes': stat.st_size,
            'size_formatted': format_file_size(stat.st_size),
            'mtime': stat.st_mtime,
        }
    except Exception as e:
        return None


def scan_recordings():
    """Scan for video recordings in organized folders and raw OBS folder."""
    global allowed_paths

    settings = load_settings()
    organized_path = settings.get('organized_path', '')
    obs_path = get_obs_recording_path()
    clips_path = get_clips_path()

    # Update allowed paths for security
    allowed_paths = set()
    if organized_path:
        allowed_paths.add(os.path.normpath(organized_path).lower())
    if obs_path:
        allowed_paths.add(os.path.normpath(obs_path).lower())
    if clips_path:
        allowed_paths.add(os.path.normpath(clips_path).lower())

    recordings = []
    seen_paths = set()

    # Scan organized folders first (these have game names in folder structure)
    if organized_path and os.path.exists(organized_path):
        try:
            for folder in os.listdir(organized_path):
                # Skip the Clips folder
                if folder.lower() == 'clips':
                    continue

                folder_path = os.path.join(organized_path, folder)
                if os.path.isdir(folder_path):
                    # Parse game name from folder: "GameName - Week of ..."
                    game_name = folder.split(" - Week of")[0] if " - Week of" in folder else folder
                    try:
                        for filename in os.listdir(folder_path):
                            _, ext = os.path.splitext(filename)
                            if ext.lower() in VIDEO_EXTENSIONS:
                                file_path = os.path.join(folder_path, filename)
                                info = parse_recording_info(file_path, game_name)
                                if info:
                                    recordings.append(info)
                                    seen_paths.add(os.path.normpath(file_path).lower())
                    except PermissionError:
                        continue
        except PermissionError:
            pass

    # Scan raw OBS folder for unorganized recordings
    # Only include files matching OBS naming patterns to avoid listing unrelated videos
    obs_filename_pattern = re.compile(
        r'^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}|'  # Default: "2024-10-17 12-20-26"
        r'^Replay \d{4}-\d{2}-\d{2}|'                # Replay buffer
        r'.+ Session \d{4}-\d{2}-\d{2} #\d+'          # Our organized naming
    )
    if obs_path and os.path.exists(obs_path):
        try:
            for filename in os.listdir(obs_path):
                name_no_ext, ext = os.path.splitext(filename)
                if ext.lower() in VIDEO_EXTENSIONS and obs_filename_pattern.match(name_no_ext):
                    file_path = os.path.join(obs_path, filename)
                    normalized = os.path.normpath(file_path).lower()
                    if normalized not in seen_paths:
                        info = parse_recording_info(file_path, "(Unorganized)")
                        if info:
                            recordings.append(info)
        except PermissionError:
            pass

    # Sort by modification time, newest first
    recordings.sort(key=lambda r: r['mtime'], reverse=True)
    return recordings


def scan_clips():
    """Scan for video clips in the Clips folder."""
    clips_path = get_clips_path()
    clips = []

    if not clips_path or not os.path.exists(clips_path):
        return clips

    try:
        for filename in os.listdir(clips_path):
            _, ext = os.path.splitext(filename)
            if ext.lower() in VIDEO_EXTENSIONS:
                file_path = os.path.join(clips_path, filename)

                # Parse game name from filename: "GameName Clip YYYY-MM-DD #N.ext"
                game_match = re.match(r'^(.+?) Clip \d{4}-\d{2}-\d{2}', filename)
                game_name = game_match.group(1) if game_match else "Unknown"

                info = parse_recording_info(file_path, game_name)
                if info:
                    clips.append(info)
    except PermissionError:
        pass

    # Sort by modification time, newest first
    clips.sort(key=lambda c: c['mtime'], reverse=True)
    return clips


def is_path_allowed(file_path):
    """Check if the file path is within allowed directories."""
    if not file_path:
        return False

    normalized = os.path.normpath(os.path.abspath(file_path)).lower()

    for allowed in allowed_paths:
        if normalized.startswith(allowed):
            return True
    return False


def check_ffmpeg():
    """Check if FFmpeg is available."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        return result.returncode == 0
    except:
        return False


def count_clips_for_date(clips_path, game_name, date_str):
    """Count existing clips for a game on a specific date."""
    pattern = f"{game_name} Clip {date_str} #"
    count = 0

    if os.path.exists(clips_path):
        for filename in os.listdir(clips_path):
            if filename.startswith(pattern):
                match = re.search(r'#(\d+)', filename)
                if match:
                    num = int(match.group(1))
                    count = max(count, num)

    return count


# ============ Routes ============

@app.route('/')
def index():
    """Serve the React app."""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def catch_all(path):
    """Catch-all route for React Router and static files."""
    # Try to serve static file first
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)

    # For non-API routes, serve the React app (for client-side routing)
    if not path.startswith('api/'):
        return send_from_directory(app.static_folder, 'index.html')

    return "Not found", 404


@app.route('/api/recordings')
def get_recordings():
    """Get list of all recordings."""
    recordings = scan_recordings()
    return jsonify(recordings)


@app.route('/api/clips')
def get_clips():
    """Get list of all clips."""
    clips = scan_clips()
    return jsonify(clips)


@app.route('/api/video')
def stream_video():
    """Stream a video file with range request support for seeking."""
    path = request.args.get('path', '')

    if not path or not is_path_allowed(path):
        return "Access denied", 403

    if not os.path.exists(path):
        return "File not found", 404

    _, ext = os.path.splitext(path)
    mime_type = MIME_TYPES.get(ext.lower(), 'video/mp4')
    serve_path = path

    file_size = os.path.getsize(serve_path)
    range_header = request.headers.get('Range')

    if range_header:
        byte_start = 0
        byte_end = file_size - 1

        match = re.search(r'bytes=(\d+)-(\d*)', range_header)
        if match:
            byte_start = int(match.group(1))
            if match.group(2):
                byte_end = int(match.group(2))

        content_length = byte_end - byte_start + 1

        def generate():
            with open(serve_path, 'rb') as f:
                f.seek(byte_start)
                remaining = content_length
                chunk_size = 1024 * 1024  # 1MB chunks
                while remaining > 0:
                    chunk = f.read(min(chunk_size, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        response = Response(
            generate(),
            status=206,
            mimetype=mime_type,
            direct_passthrough=True
        )
        response.headers['Content-Range'] = f'bytes {byte_start}-{byte_end}/{file_size}'
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Length'] = content_length
        return response

    # No range request - stream with Accept-Ranges header
    def generate_full():
        with open(serve_path, 'rb') as f:
            chunk_size = 1024 * 1024  # 1MB chunks
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    response = Response(
        generate_full(),
        status=200,
        mimetype=mime_type,
        direct_passthrough=True
    )
    response.headers['Accept-Ranges'] = 'bytes'
    response.headers['Content-Length'] = file_size
    return response


@app.route('/api/clips/create', methods=['POST'])
def create_clip():
    """Create a clip from a recording using FFmpeg."""
    data = request.get_json()
    source_path = data.get('source_path', '')
    start_time = data.get('start_time', 0)
    end_time = data.get('end_time', 0)
    game_name = data.get('game_name', 'Unknown')
    audio_tracks = data.get('audio_tracks', None)  # list of audio stream indices, or None for all

    # Validate inputs
    if not source_path or not is_path_allowed(source_path):
        return jsonify({'error': 'Invalid source path'}), 403

    if not os.path.exists(source_path):
        return jsonify({'error': 'Source file not found'}), 404

    if end_time <= start_time:
        return jsonify({'error': 'End time must be greater than start time'}), 400

    # Check FFmpeg
    if not check_ffmpeg():
        return jsonify({'error': 'FFmpeg not found. Please install FFmpeg and add it to PATH.'}), 500

    # Get clips folder
    clips_path = get_clips_path()
    if not clips_path:
        return jsonify({'error': 'Could not determine clips folder'}), 500

    # Create clips folder if needed
    os.makedirs(clips_path, exist_ok=True)

    # Update allowed paths to include clips folder
    allowed_paths.add(os.path.normpath(clips_path).lower())

    # Generate output filename
    date_str = datetime.now().strftime("%Y-%m-%d")
    clip_num = count_clips_for_date(clips_path, game_name, date_str) + 1
    output_filename = f"{game_name} Clip {date_str} #{clip_num}.mp4"
    output_path = os.path.join(clips_path, output_filename)

    # Calculate duration
    duration = end_time - start_time

    # Run FFmpeg - use -map flags if specific audio tracks requested
    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-i', source_path,
        '-t', str(duration),
    ]
    if audio_tracks is not None and isinstance(audio_tracks, list):
        cmd += ['-map', '0:v:0']
        for track_idx in audio_tracks:
            cmd += ['-map', f'0:a:{track_idx}']
    cmd += ['-c', 'copy', '-avoid_negative_ts', 'make_zero', output_path]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )

        if result.returncode != 0:
            return jsonify({'error': f'FFmpeg error: {result.stderr}'}), 500

        # Return clip info
        clip_info = parse_recording_info(output_path, game_name)
        return jsonify(clip_info)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/clips/delete', methods=['POST'])
def delete_clip():
    """Delete a clip file."""
    data = request.get_json()
    path = data.get('path', '')

    clips_path = get_clips_path()

    if not path or not clips_path:
        return jsonify({'error': 'Invalid path'}), 403

    # Only allow deleting files in the clips folder
    normalized = os.path.normpath(os.path.abspath(path)).lower()
    clips_normalized = os.path.normpath(clips_path).lower()

    if not normalized.startswith(clips_normalized):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.remove(path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/open-external', methods=['POST'])
def open_external():
    """Open video in default external player."""
    data = request.get_json()
    path = data.get('path', '')

    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.startfile(path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/show-in-explorer', methods=['POST'])
def show_in_explorer():
    """Show video file in Windows Explorer."""
    data = request.get_json()
    path = data.get('path', '')

    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    try:
        normalized = os.path.normpath(path)
        subprocess.run(f'explorer /select,"{normalized}"')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/delete', methods=['POST'])
def delete_recording():
    """Delete a recording file."""
    data = request.get_json()
    path = data.get('path', '')

    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.remove(path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ffmpeg-check')
def ffmpeg_check():
    """Check if FFmpeg is available."""
    available = check_ffmpeg()
    return jsonify({'available': available})


@app.route('/api/reencode', methods=['POST'])
def reencode_video():
    """Reencode a video to a different codec."""
    data = request.get_json()
    source_path = data.get('source_path', '')
    codec = data.get('codec', 'h265')  # h264, h265, av1, copy
    crf = data.get('crf', 23)  # Quality: lower = better (18-28 typical range)
    preset = data.get('preset', 'medium')  # ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
    replace_original = data.get('replace_original', False)
    audio_tracks = data.get('audio_tracks', None)  # list of audio stream indices, or None for all

    if not source_path or not is_path_allowed(source_path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(source_path):
        return jsonify({'error': 'File not found'}), 404

    # Check FFmpeg
    if not check_ffmpeg():
        return jsonify({'error': 'FFmpeg not found. Please install FFmpeg and add it to PATH.'}), 500

    # Determine codec settings
    codec_map = {
        'h264': {'codec': 'libx264', 'ext': '.mp4'},
        'h265': {'codec': 'libx265', 'ext': '.mp4'},
        'av1': {'codec': 'libsvtav1', 'ext': '.mp4'},
        'copy': {'codec': 'copy', 'ext': '.mp4'},
    }

    if codec not in codec_map:
        return jsonify({'error': 'Invalid codec'}), 400

    codec_info = codec_map[codec]
    is_remux = (codec == 'copy')

    # Generate output path
    base, ext = os.path.splitext(source_path)
    if replace_original:
        output_path = base + '_temp' + codec_info['ext']
    else:
        suffix = '_remuxed' if is_remux else f'_reencoded_{codec}'
        output_path = base + suffix + codec_info['ext']

    # Build FFmpeg command
    cmd = ['ffmpeg', '-y', '-i', source_path]

    # Add stream mapping if specific audio tracks requested
    if audio_tracks is not None and isinstance(audio_tracks, list):
        cmd += ['-map', '0:v:0']
        for track_idx in audio_tracks:
            cmd += ['-map', f'0:a:{track_idx}']

    if is_remux:
        cmd += ['-c', 'copy']
    else:
        cmd += ['-c:v', codec_info['codec'], '-crf', str(crf), '-preset', preset, '-c:a', 'copy']

    cmd.append(output_path)
    
    try:
        # Run FFmpeg (this will take time for large files)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        
        if result.returncode != 0:
            # Clean up temp file if it exists
            if os.path.exists(output_path):
                os.remove(output_path)
            return jsonify({'error': f'FFmpeg error: {result.stderr}'}), 500
        
        # If replacing original, swap files
        if replace_original:
            try:
                os.remove(source_path)
                os.rename(output_path, source_path)
                output_path = source_path
            except Exception as e:
                return jsonify({'error': f'Failed to replace original: {str(e)}'}), 500
        
        # Get file info
        stat = os.stat(output_path)
        original_size = os.path.getsize(source_path) if not replace_original else data.get('original_size', 0)
        
        return jsonify({
            'success': True,
            'output_path': output_path,
            'size_bytes': stat.st_size,
            'size_formatted': format_file_size(stat.st_size),
            'original_size': original_size,
            'savings': original_size - stat.st_size if original_size > 0 else 0,
            'savings_formatted': format_file_size(max(0, original_size - stat.st_size)) if original_size > 0 else '0 B'
        })
        
    except Exception as e:
        # Clean up temp file if it exists
        if os.path.exists(output_path) and output_path != source_path:
            try:
                os.remove(output_path)
            except:
                pass
        return jsonify({'error': str(e)}), 500


@app.route('/api/video/tracks')
def video_tracks():
    """Get audio track info for a video file."""
    path = request.args.get('path', '')

    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    if not check_ffmpeg():
        return jsonify({'error': 'FFmpeg/FFprobe not found'}), 500

    tracks = get_audio_tracks(path)
    return jsonify({'tracks': tracks})


@app.route('/api/markers')
def get_markers():
    """Get clip markers for a specific recording."""
    path = request.args.get('path', '')
    game_name = request.args.get('game_name', '')

    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    # Get file modification time and duration
    try:
        stat = os.stat(path)
        file_mtime = stat.st_mtime
        duration = get_video_duration(path)

        if not duration:
            return jsonify({'markers': [], 'error': 'Could not determine video duration'})

        markers = get_markers_for_recording(game_name, file_mtime, duration)
        return jsonify({'markers': markers, 'duration': duration})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/markers/delete', methods=['POST'])
def delete_marker():
    """Delete a specific clip marker."""
    data = request.get_json()
    timestamp = data.get('timestamp')

    if not timestamp:
        return jsonify({'error': 'Timestamp required'}), 400

    markers_data = load_markers()
    original_count = len(markers_data.get("markers", []))

    # Remove marker with matching timestamp
    markers_data["markers"] = [
        m for m in markers_data.get("markers", [])
        if m.get("timestamp") != timestamp
    ]

    if len(markers_data["markers"]) < original_count:
        save_markers(markers_data)
        return jsonify({'success': True})
    else:
        return jsonify({'error': 'Marker not found'}), 404


@app.route('/api/storage/stats')
def get_storage_stats():
    """Get storage statistics for recordings and clips."""
    recordings = scan_recordings()
    clips = scan_clips()
    settings = load_settings()
    locked_recordings = settings.get('locked_recordings', [])
    
    # Calculate total sizes
    total_recording_size = sum(r['size_bytes'] for r in recordings)
    total_clip_size = sum(c['size_bytes'] for c in clips)
    total_size = total_recording_size + total_clip_size
    
    # Group by game
    games = {}
    for r in recordings:
        game = r['game_name']
        if game not in games:
            games[game] = {'recordings': [], 'clips': [], 'total_size': 0}
        games[game]['recordings'].append(r)
        games[game]['total_size'] += r['size_bytes']
    
    for c in clips:
        game = c['game_name']
        if game not in games:
            games[game] = {'recordings': [], 'clips': [], 'total_size': 0}
        games[game]['clips'].append(c)
        games[game]['total_size'] += c['size_bytes']
    
    # Get disk usage
    organized_path = settings.get('organized_path', '')
    disk_usage = None
    if organized_path and os.path.exists(organized_path):
        try:
            import shutil
            total, used, free = shutil.disk_usage(organized_path)
            disk_usage = {
                'total': total,
                'used': used,
                'free': free,
                'total_formatted': format_file_size(total),
                'used_formatted': format_file_size(used),
                'free_formatted': format_file_size(free),
                'percent_used': (used / total * 100) if total > 0 else 0
            }
        except:
            pass
    
    return jsonify({
        'recordings': recordings,
        'clips': clips,
        'total_size': total_size,
        'total_size_formatted': format_file_size(total_size),
        'recording_size': total_recording_size,
        'recording_size_formatted': format_file_size(total_recording_size),
        'clip_size': total_clip_size,
        'clip_size_formatted': format_file_size(total_clip_size),
        'recording_count': len(recordings),
        'clip_count': len(clips),
        'games': games,
        'disk_usage': disk_usage,
        'locked_recordings': locked_recordings
    })


@app.route('/api/storage/settings', methods=['GET', 'POST'])
def storage_settings():
    """Get or update storage settings."""
    settings = load_settings()
    
    if request.method == 'POST':
        data = request.get_json()
        
        # Update storage settings
        if 'storage_settings' in data:
            if 'storage_settings' not in settings:
                settings['storage_settings'] = {}
            settings['storage_settings'].update(data['storage_settings'])
        
        if save_settings(settings):
            return jsonify({'success': True, 'settings': settings.get('storage_settings', {})})
        else:
            return jsonify({'error': 'Failed to save settings'}), 500
    
    return jsonify(settings.get('storage_settings', {
        'auto_delete_enabled': False,
        'max_storage_gb': 100,
        'max_age_days': 30,
        'exclude_clips': True
    }))


@app.route('/api/storage/lock', methods=['POST'])
def lock_recording():
    """Lock or unlock a recording to prevent deletion."""
    data = request.get_json()
    path = data.get('path', '')
    locked = data.get('locked', True)
    
    if not path or not is_path_allowed(path):
        return jsonify({'error': 'Invalid path'}), 400
    
    settings = load_settings()
    if 'locked_recordings' not in settings:
        settings['locked_recordings'] = []
    
    normalized_path = os.path.normpath(path)
    
    if locked:
        # Add to locked list
        if normalized_path not in settings['locked_recordings']:
            settings['locked_recordings'].append(normalized_path)
    else:
        # Remove from locked list
        if normalized_path in settings['locked_recordings']:
            settings['locked_recordings'].remove(normalized_path)
    
    if save_settings(settings):
        return jsonify({'success': True, 'locked': locked})
    else:
        return jsonify({'error': 'Failed to save settings'}), 500


@app.route('/api/storage/delete-batch', methods=['POST'])
def delete_batch():
    """Delete multiple recordings/clips at once."""
    data = request.get_json()
    paths = data.get('paths', [])
    
    if not paths:
        return jsonify({'error': 'No paths provided'}), 400
    
    settings = load_settings()
    locked_recordings = [os.path.normpath(p) for p in settings.get('locked_recordings', [])]
    
    deleted = []
    failed = []
    skipped_locked = []
    
    for path in paths:
        if not is_path_allowed(path):
            failed.append({'path': path, 'error': 'Access denied'})
            continue
        
        # Check if locked
        normalized_path = os.path.normpath(path)
        if normalized_path in locked_recordings:
            skipped_locked.append(path)
            continue
        
        try:
            if os.path.exists(path):
                os.remove(path)
                deleted.append(path)
            else:
                failed.append({'path': path, 'error': 'File not found'})
        except Exception as e:
            failed.append({'path': path, 'error': str(e)})
    
    return jsonify({
        'success': True,
        'deleted': deleted,
        'deleted_count': len(deleted),
        'failed': failed,
        'failed_count': len(failed),
        'skipped_locked': skipped_locked,
        'skipped_locked_count': len(skipped_locked)
    })


def main():
    """Start the server and open browser."""
    import webbrowser
    import threading

    # Scan recordings once to populate allowed_paths
    scan_recordings()

    # Open browser after a short delay
    def open_browser():
        import time
        time.sleep(0.5)
        webbrowser.open('http://localhost:5050')

    threading.Thread(target=open_browser, daemon=True).start()

    # Run Flask server
    app.run(host='127.0.0.1', port=5050, debug=False, threaded=True)


if __name__ == '__main__':
    main()
