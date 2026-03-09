// QR Code reader for OBS WebSocket settings
const { Jimp } = require('jimp');
const jsQR = require('jsqr');

/**
 * Read and decode a QR code from an image file or buffer.
 * @param {string|Buffer} imageSource - Path to the image file or image buffer
 * @returns {Promise<string|null>} The decoded QR code data or null if not found
 */
async function readQRCode(imageSource) {
  try {
    // Load the image (Jimp handles both file paths and buffers)
    const image = await Jimp.read(imageSource);
    
    // Convert to RGBA format for jsQR
    const imageData = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height,
    };
    
    // Decode the QR code
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    
    return code ? code.data : null;
  } catch (err) {
    console.error('[qrCodeReader] Error reading QR code:', err);
    throw new Error(`Failed to read QR code: ${err.message}`);
  }
}

/**
 * Parse OBS WebSocket connection string from QR code data.
 * OBS QR codes typically contain a JSON string with connection details.
 * Format: {"host":"localhost","port":4455,"password":"your_password"}
 * 
 * @param {string} qrData - The decoded QR code data
 * @returns {object|null} Parsed connection settings { host, port, password } or null if invalid
 */
function parseOBSWebSocketQR(qrData) {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(qrData);
    
    // Validate that it has the expected OBS WebSocket fields
    if (parsed && typeof parsed === 'object') {
      const result = {};
      
      if (parsed.host || parsed.address || parsed.ip) {
        result.host = parsed.host || parsed.address || parsed.ip;
      }
      
      if (parsed.port) {
        result.port = parseInt(parsed.port, 10);
      }
      
      if (parsed.password || parsed.pass) {
        result.password = parsed.password || parsed.pass;
      }
      
      // Return null if no valid fields found
      if (Object.keys(result).length === 0) {
        return null;
      }
      
      return result;
    }
    
    return null;
  } catch (err) {
    // Not JSON, might be a different format
    // Try to parse as a connection string (e.g., "ws://host:port?password=xyz")
    try {
      const url = new URL(qrData);
      const result = {};
      
      if (url.hostname) {
        result.host = url.hostname;
      }
      
      if (url.port) {
        result.port = parseInt(url.port, 10);
      }
      
      // Check for password in query params
      const password = url.searchParams.get('password') || url.searchParams.get('pass');
      if (password) {
        result.password = password;
      }
      
      return Object.keys(result).length > 0 ? result : null;
    } catch {
      return null;
    }
  }
}

/**
 * Read OBS WebSocket settings from a QR code image.
 * @param {string|Buffer} imageSource - Path to the QR code image or image buffer
 * @returns {Promise<{success: boolean, settings?: object, message?: string}>}
 */
async function readOBSWebSocketQR(imageSource) {
  try {
    const qrData = await readQRCode(imageSource);
    
    if (!qrData) {
      return { success: false, message: 'No QR code found in the image' };
    }
    
    const settings = parseOBSWebSocketQR(qrData);
    
    if (!settings) {
      return { success: false, message: 'QR code does not contain valid OBS WebSocket settings' };
    }
    
    return { success: true, settings };
  } catch (err) {
    return { success: false, message: err.message || 'Failed to read QR code' };
  }
}

module.exports = { readQRCode, parseOBSWebSocketQR, readOBSWebSocketQR };
