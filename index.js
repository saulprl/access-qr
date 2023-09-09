const http = require("http");
const Jimp = require("jimp");
const jsQR = require("jsqr");
// const Gpio = require("onoff").Gpio;
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: "./.env.local" });

// const door = new Gpio(18, "out");

// Replace with your camera's IP address
const cameraIp = process.env.CAMERA_IP;
const API_URL = process.env.ACCESS_API_URL;
const roomName = process.env.ROOM_NAME;
const roomBuilding = process.env.ROOM_BUILDING;
const room = process.env.ROOM;
const credentials = process.env.CREDENTIALS;

let lastToken = "";

// HTTP request options
const options = {
  host: cameraIp,
  path: "/img/video.mjpeg", // Adjust the path as needed
  headers: {
    Authorization: "Basic " + Buffer.from(credentials).toString("base64"), // Replace with your camera's credentials
  },
};

// Create an HTTP request to the camera's MJPEG video feed
const request = http.get(options, (response) => {
  // Create a buffer to store the video data
  let videoBuffer = Buffer.from([]);
  console.log("Connected to camera");
  const frameProcessingInterval = 1000;

  let canProcessFrame = true;

  response.on("data", (data) => {
    // Append data to the video buffer
    videoBuffer = Buffer.concat([videoBuffer, data]);

    // Find the start and end of each frame
    let startIndex = 0;
    let endIndex = 0;
    while (startIndex < videoBuffer.length) {
      // Find the start marker (0xFFD8)
      startIndex = videoBuffer.indexOf(Buffer.from([0xff, 0xd8]), startIndex);
      if (startIndex === -1) {
        // Start marker not found, exit the loop
        break;
      }

      // Find the end marker (0xFFD9)
      endIndex = videoBuffer.indexOf(Buffer.from([0xff, 0xd9]), startIndex);
      if (endIndex === -1) {
        // End marker not found, exit the loop
        break;
      }

      // Extract the frame between start and end markers
      const frameData = videoBuffer.slice(startIndex, endIndex + 2); // Include the end marker
      startIndex = endIndex + 2; // Move to the next frame

      // Process the frame (e.g., decode using Jimp and recognize QR codes)
      if (canProcessFrame) {
        canProcessFrame = false;

        processFrame(frameData);

        setTimeout(() => {
          canProcessFrame = true;
        }, frameProcessingInterval);
      }
    }

    // Remove processed data from the video buffer
    videoBuffer = videoBuffer.slice(endIndex + 2);
  });
});

async function processFrame(frameData) {
  // Convert the frame to a Jimp image
  Jimp.read(frameData, (err, image) => {
    if (err) {
      console.error("Error reading frame:", err);
      return;
    }
    // Decode the frame using jsQR to recognize QR codes
    const pixels = new Uint8ClampedArray(image.bitmap.data.buffer);
    const decoded = jsQR(pixels, image.bitmap.width, image.bitmap.height);

    // Display and process the frame as needed
    if (decoded) {
      const { data } = decoded;
      makeRequest(data);
    }
  });
}

request.on("error", (error) => {
  console.error("Error connecting to the camera:", error);
});

/**
 * Makes a request to a specific API endpoint which expects a JWT string. If the request is successful and the user is granted access, output a signal through the specified PIN (GPIO 18).
 */
const makeRequest = async function (token) {
  if (lastToken === token) {
    console.log("makeRequest -> token already used");
    return;
  }

  lastToken = token;
  setTimeout(() => {
    lastToken = "";
  }, 10000);

  console.log("makeRequest -> started");
  const authData = {
    token,
    roomName,
    roomBuilding,
    room,
  };

  try {
    // Makes the post request to the validation API
    const res = await axios.post(`${API_URL}/api/access/token`, {
      token,
      roomName,
      roomBuilding,
      room,
    });

    const data = res.data;
    // console.log(data);
    if (data["grantedAccess"] === true) {
      console.log("on -> grantedAccess");
      // door.write(1).then((_) => setTimeout(() => door.write(0), 2000));
    }
  } catch (error) {
    console.log("makeRequest -> error: ", error);
  }
};

process.on("SIGINT", (_) => {
  // door.unexport();
  process.exit();
});
